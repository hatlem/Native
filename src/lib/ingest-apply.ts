// Executes a validated ingestion payload for one publisher. Idempotent:
// titles upsert on (publisherId, externalRef), products on (titleId,
// externalRef), specs on productId, availability on (productId, year,
// month). All scoped to the key's publisher — callers must pass the
// authenticated publisherId, never one from the request body.
//
// Curation gate: a brand-new title is created inactive; the super-admin
// activates it before it reaches the public catalog. Updates never flip
// `active` — only the desk does that — and never write a product's
// desk-owned fields (price, visibility, bookable; lib/ingest.ts).

import { prisma } from "@/lib/prisma";
import {
  NEW_PRODUCT_DEFAULTS,
  deskOwnedFieldChanges,
  ingestionSlug,
  type DeskOwnedRefusal,
  type IngestPayload,
} from "@/lib/ingest";

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

/**
 * Every desk-owned field the payload would change, across the whole batch —
 * checked before anything is written, so a refused call changes nothing. The
 * stored product is looked up the same way applyIngestion resolves it: by the
 * title's externalRef within this publisher, then the product's externalRef.
 */
export async function findDeskOwnedFieldChanges(
  publisherId: string,
  payload: IngestPayload,
): Promise<DeskOwnedRefusal[]> {
  const stored = await prisma.product.findMany({
    where: {
      externalRef: { in: payload.products.map((p) => p.externalRef) },
      title: {
        publisherId,
        externalRef: { in: payload.products.map((p) => p.title.externalRef) },
      },
    },
    select: {
      externalRef: true,
      basePrice: true,
      visibility: true,
      bookable: true,
      title: { select: { externalRef: true } },
    },
  });
  const key = (titleRef: string | null, productRef: string | null) => `${titleRef}\u0000${productRef}`;
  const byRef = new Map(
    stored.map((s) => [
      key(s.title.externalRef, s.externalRef),
      { basePrice: Number(s.basePrice), visibility: s.visibility, bookable: s.bookable },
    ]),
  );
  return payload.products.flatMap((p, i) =>
    deskOwnedFieldChanges(p, byRef.get(key(p.title.externalRef, p.externalRef)) ?? null, i),
  );
}

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
      if (existingProduct) {
        // basePrice / visibility / bookable are desk-owned and never written
        // on an update (lib/ingest deskOwnedFieldChanges): the route refuses a
        // payload that would change them, and a desk edit landing between that
        // check and this write must not be overwritten either.
        await tx.product.update({
          where: { id: existingProduct.id },
          data: {
            type: p.type,
            name: p.name,
            description: p.description ?? existingProduct.description,
            currency: p.currency,
            leadTimeDays: p.leadTimeDays ?? existingProduct.leadTimeDays,
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
            // The opening rate card. It stays unconfirmed (confirmedAt null),
            // so nothing is quoted off it until the desk confirms it.
            basePrice: p.basePrice,
            currency: p.currency,
            leadTimeDays: p.leadTimeDays ?? null,
            // Desk-owned from the start: a new product never arrives firm
            // (instantly orderable) or pulled — those are the desk's calls.
            visibility: NEW_PRODUCT_DEFAULTS.visibility,
            bookable: NEW_PRODUCT_DEFAULTS.bookable,
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

      return { titleId, productId, titleCreated, productCreated };
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
    // No title.price_changed webhook from here any more: an ingestion can no
    // longer move an existing product's price (it is desk-owned), so there is
    // no price change to announce.
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
