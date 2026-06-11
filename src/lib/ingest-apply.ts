// Executes a validated ingestion payload for one publisher. Idempotent:
// titles upsert on (publisherId, externalRef), products on (titleId,
// externalRef), specs on productId, availability on (productId, year,
// month). All scoped to the key's publisher — callers must pass the
// authenticated publisherId, never one from the request body.
//
// Curation gate: a brand-new title is created inactive; the super-admin
// activates it before it reaches the public catalog. Updates never flip
// `active` — only the desk does that.

import { prisma } from "@/lib/prisma";
import { fireWebhook } from "@/lib/webhooks";
import { ingestionSlug, type IngestPayload } from "@/lib/ingest";

export type IngestSummary = {
  titlesCreated: number;
  titlesUpdated: number;
  productsCreated: number;
  productsUpdated: number;
  // Products skipped because their currency didn't match the market's —
  // surfaced so the caller can fix and re-send (idempotent).
  skipped: { externalRef: string; reason: string }[];
  results: { externalRef: string; titleId: string; productId: string }[];
};

export async function applyIngestion(
  publisherId: string,
  payload: IngestPayload,
): Promise<IngestSummary> {
  const summary: IngestSummary = {
    titlesCreated: 0,
    titlesUpdated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    skipped: [],
    results: [],
  };

  const markets = await prisma.market.findMany({
    select: { id: true, code: true, currency: true },
  });
  const marketByCode = new Map(markets.map((m) => [m.code, m]));

  for (const p of payload.products) {
    const market = marketByCode.get(p.title.marketCode);
    if (!market) continue; // enum-constrained, so unreachable in practice

    // Reject a currency that doesn't match the market — the commerce layer
    // always quotes in the market currency, so a mismatch is a data error.
    if (p.currency.toUpperCase() !== market.currency.toUpperCase()) {
      summary.skipped.push({
        externalRef: p.externalRef,
        reason: `currency ${p.currency} != market ${market.currency}`,
      });
      continue;
    }

    // Each product's writes are atomic — a mid-product failure rolls back
    // so we never leave a half-ingested product. We collect side effects
    // (counters, webhook) and apply them only after the tx commits.
    const outcome = await prisma.$transaction(async (tx) => {
      // --- Title upsert (publisher-scoped) ---
      const existingTitle = await tx.title.findUnique({
        where: {
          publisherId_externalRef: {
            publisherId,
            externalRef: p.title.externalRef,
          },
        },
      });

      let titleId: string;
      let titleActive: boolean;
      let titleCreated = false;
      if (existingTitle) {
        // Never touch slug (stable for links/SEO) or `active` (desk-owned).
        await tx.title.update({
          where: { id: existingTitle.id },
          data: {
            name: p.title.name,
            category: p.title.category,
            marketId: market.id,
            countryCode: market.code,
            websiteUrl: p.title.websiteUrl ?? existingTitle.websiteUrl,
            audienceNote: p.title.audienceNote ?? existingTitle.audienceNote,
            lastVerifiedAt: new Date(),
          },
        });
        titleId = existingTitle.id;
        titleActive = existingTitle.active;
      } else {
        const created = await tx.title.create({
          data: {
            name: p.title.name,
            slug: await uniqueSlug(tx, ingestionSlug(publisherId, p.title.externalRef)),
            publisherId,
            externalRef: p.title.externalRef,
            countryCode: market.code,
            marketId: market.id,
            category: p.title.category,
            websiteUrl: p.title.websiteUrl ?? null,
            audienceNote: p.title.audienceNote ?? null,
            active: false, // curation gate
            lastVerifiedAt: new Date(),
          },
        });
        titleId = created.id;
        titleActive = false;
        titleCreated = true;
      }

      // --- Product upsert (title-scoped) ---
      const existingProduct = await tx.product.findUnique({
        where: {
          titleId_externalRef: { titleId, externalRef: p.externalRef },
        },
      });

      let productId: string;
      let productCreated = false;
      let priceChanged = false;
      if (existingProduct) {
        priceChanged = Number(existingProduct.basePrice) !== p.basePrice;
        await tx.product.update({
          where: { id: existingProduct.id },
          data: {
            type: p.type,
            name: p.name,
            description: p.description ?? existingProduct.description,
            basePrice: p.basePrice,
            currency: p.currency,
            leadTimeDays: p.leadTimeDays ?? existingProduct.leadTimeDays,
            visibility: p.visibility ?? existingProduct.visibility,
            bookable: p.bookable ?? existingProduct.bookable,
          },
        });
        productId = existingProduct.id;
      } else {
        const created = await tx.product.create({
          data: {
            titleId,
            externalRef: p.externalRef,
            type: p.type,
            name: p.name,
            description: p.description ?? null,
            basePrice: p.basePrice,
            currency: p.currency,
            leadTimeDays: p.leadTimeDays ?? null,
            visibility: p.visibility ?? "INDICATIVE",
            bookable: p.bookable ?? true,
          },
        });
        productId = created.id;
        productCreated = true;
      }

      // --- Spec upsert ---
      if (p.spec) {
        const specData = {
          wordCountMin: p.spec.wordCountMin ?? null,
          wordCountMax: p.spec.wordCountMax ?? null,
          imagesMin: p.spec.imagesMin ?? null,
          disclosureLabel: p.spec.disclosureLabel ?? null,
          fileFormats: p.spec.fileFormats ?? null,
          requirements: p.spec.requirements ?? null,
        };
        await tx.spec.upsert({
          where: { productId },
          create: { productId, ...specData },
          update: specData,
        });
      }

      // --- Availability upsert ---
      for (const a of p.availability ?? []) {
        await tx.availability.upsert({
          where: {
            productId_year_month: { productId, year: a.year, month: a.month },
          },
          create: { productId, year: a.year, month: a.month, blocked: a.blocked },
          update: { blocked: a.blocked },
        });
      }

      return { titleId, productId, titleCreated, productCreated, priceChanged, titleActive };
    });

    if (outcome.titleCreated) summary.titlesCreated++;
    else summary.titlesUpdated++;
    if (outcome.productCreated) summary.productsCreated++;
    else summary.productsUpdated++;
    summary.results.push({
      externalRef: p.externalRef,
      titleId: outcome.titleId,
      productId: outcome.productId,
    });

    // Notify partners of a price move only on already-public titles, and
    // only after the write committed.
    if (outcome.priceChanged && outcome.titleActive) {
      fireWebhook("title.price_changed", {
        title_id: outcome.titleId,
        product_id: outcome.productId,
        base_price: p.basePrice,
        currency: p.currency,
      });
    }
  }

  return summary;
}

// Title.slug is globally unique. The ingestion slug embeds the publisher
// id so collisions are essentially impossible, but guard anyway: append a
// short numeric suffix until free. Runs inside the product transaction so
// the existence check and create can't race.
type SlugClient = { title: { findUnique: typeof prisma.title.findUnique } };
async function uniqueSlug(client: SlugClient, base: string): Promise<string> {
  let candidate = base;
  let n = 1;
  while (await client.title.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${n++}`;
    if (n > 50) {
      candidate = `${base}-${Date.now()}`;
      break;
    }
  }
  return candidate;
}
