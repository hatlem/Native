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
    results: [],
  };

  const markets = await prisma.market.findMany({
    select: { id: true, code: true },
  });
  const marketByCode = new Map(markets.map((m) => [m.code, m]));

  for (const p of payload.products) {
    const market = marketByCode.get(p.title.marketCode);
    if (!market) continue; // enum-constrained, so unreachable in practice

    // --- Title upsert (publisher-scoped) ---
    const existingTitle = await prisma.title.findUnique({
      where: {
        publisherId_externalRef: {
          publisherId,
          externalRef: p.title.externalRef,
        },
      },
    });

    let titleId: string;
    let titleActive: boolean;
    if (existingTitle) {
      // Never touch slug (stable for links/SEO) or `active` (desk-owned).
      await prisma.title.update({
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
      summary.titlesUpdated++;
    } else {
      const created = await prisma.title.create({
        data: {
          name: p.title.name,
          slug: await uniqueSlug(ingestionSlug(publisherId, p.title.externalRef)),
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
      summary.titlesCreated++;
    }

    // --- Product upsert (title-scoped) ---
    const existingProduct = await prisma.product.findUnique({
      where: {
        titleId_externalRef: { titleId, externalRef: p.externalRef },
      },
    });

    let productId: string;
    if (existingProduct) {
      const priceChanged = Number(existingProduct.basePrice) !== p.basePrice;
      await prisma.product.update({
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
      summary.productsUpdated++;
      // Notify partners of a price move only on already-public titles.
      if (priceChanged && titleActive) {
        fireWebhook("title.price_changed", {
          title_id: titleId,
          product_id: productId,
          base_price: p.basePrice,
          currency: p.currency,
        });
      }
    } else {
      const created = await prisma.product.create({
        data: {
          titleId,
          externalRef: p.externalRef,
          type: p.type,
          name: p.name,
          description: p.description ?? null,
          basePrice: p.basePrice,
          currency: p.currency,
          leadTimeDays: p.leadTimeDays ?? 10,
          visibility: p.visibility ?? "INDICATIVE",
          bookable: p.bookable ?? true,
        },
      });
      productId = created.id;
      summary.productsCreated++;
    }

    // --- Spec upsert ---
    if (p.spec) {
      await prisma.spec.upsert({
        where: { productId },
        create: {
          productId,
          wordCountMin: p.spec.wordCountMin ?? null,
          wordCountMax: p.spec.wordCountMax ?? null,
          imagesMin: p.spec.imagesMin ?? null,
          disclosureLabel: p.spec.disclosureLabel ?? null,
          fileFormats: p.spec.fileFormats ?? null,
          requirements: p.spec.requirements ?? null,
        },
        update: {
          wordCountMin: p.spec.wordCountMin ?? null,
          wordCountMax: p.spec.wordCountMax ?? null,
          imagesMin: p.spec.imagesMin ?? null,
          disclosureLabel: p.spec.disclosureLabel ?? null,
          fileFormats: p.spec.fileFormats ?? null,
          requirements: p.spec.requirements ?? null,
        },
      });
    }

    // --- Availability upsert ---
    for (const a of p.availability ?? []) {
      await prisma.availability.upsert({
        where: {
          productId_year_month: { productId, year: a.year, month: a.month },
        },
        create: {
          productId,
          year: a.year,
          month: a.month,
          blocked: a.blocked,
        },
        update: { blocked: a.blocked },
      });
    }

    summary.results.push({ externalRef: p.externalRef, titleId, productId });
  }

  return summary;
}

// Title.slug is globally unique. The ingestion slug embeds the publisher
// id so collisions are essentially impossible, but guard anyway: append a
// short numeric suffix until free.
async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let n = 1;
  // Bounded loop — a publisher can't realistically need more than a few.
  while (await prisma.title.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${n++}`;
    if (n > 50) {
      candidate = `${base}-${Date.now()}`;
      break;
    }
  }
  return candidate;
}
