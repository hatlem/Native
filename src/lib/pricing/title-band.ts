// Title.priceBandTier — the stored copy of the band the catalog card shows,
// so the catalog's price-band filter filters and pages in the database.
//
// Correctness lives in two halves:
//   - INVALIDATION in the database: triggers bump Title.priceBandRev on every
//     write that can move a band (migration 20260930231000_title_price_band),
//     so no code path — desk pricing, quote apply/activate, the publisher
//     portal, MCP tools, scripts, raw SQL — can forget it.
//   - COMPUTATION here, with the exact titleBand() the card renders
//     (display-price.ts), so the filter and the card can never disagree.
// refreshStaleTitlePriceBands() recomputes every stale title; the catalog
// calls it before filtering on the band, and an hourly sweep
// (instrumentation-node.ts) keeps the backlog near zero.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadPricingDefaults, type PricingDefaults } from "@/lib/content-fee";
import { titleBand, type DisplayProduct, type DisplayTitle } from "./display-price";
import { bandTier } from "./bands";

// Pure: the tier a title's products produce, or null when the card shows no
// band (hidden/unconfirmed prices, rate-priced only, no products).
export function titlePriceBandTier(
  products: DisplayProduct[],
  title: DisplayTitle,
  defaults: PricingDefaults,
): number | null {
  const band = titleBand(products, title, defaults);
  return band ? bandTier(band.band, band.product.currency) : null;
}

// The catalog card is built from the title's ACTIVE products (catalog page
// titleInclude) — the stored tier must be too.
const BAND_INPUT_SELECT = {
  id: true,
  pricesPublic: true,
  productionFeeDefault: true,
  publisher: { select: { pricesPublic: true } },
  market: { select: { code: true } },
  products: {
    where: { active: true },
    select: {
      active: true,
      confirmedAt: true,
      type: true,
      basePrice: true,
      currency: true,
      pricingModel: true,
      productionFee: true,
      inclusions: true,
      priceRules: { select: { marginPct: true, seasonalMultiplier: true, minVolume: true } },
    },
  },
} satisfies Prisma.TitleSelect;

// The catalog's price-band filter clause: titles whose stored band is one of
// the chosen tiers. Callers refresh stale bands first (refreshStaleTitlePriceBands).
export function priceBandWhere(tiers: number[]): Prisma.TitleWhereInput {
  return tiers.length ? { priceBandTier: { in: tiers } } : {};
}

const BATCH = 500;
// Enough rounds to drain a full invalidation of a catalog many times today's
// size; a title rewritten faster than we can compute it just stays stale for
// the next call.
const MAX_ROUNDS = 40;

/**
 * Recompute every title whose stored band is stale. Returns how many were
 * written. Safe to run concurrently (two instances, a request and the sweep):
 * each write is conditional on the revision it computed from, so a band moved
 * by a write that landed mid-computation stays stale instead of being marked
 * current with the old value.
 */
export async function refreshStaleTitlePriceBands(): Promise<number> {
  let defaults: PricingDefaults | null = null;
  let written = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stale = await prisma.$queryRaw<{ id: string; rev: number }[]>`
      SELECT id, "priceBandRev" AS rev FROM "Title"
      WHERE "priceBandRev" <> "priceBandComputedRev"
      ORDER BY id
      LIMIT ${BATCH}`;
    if (stale.length === 0) break;
    defaults ??= await loadPricingDefaults();
    const titles = await prisma.title.findMany({
      where: { id: { in: stale.map((s) => s.id) } },
      select: BAND_INPUT_SELECT,
    });
    const tierById = new Map(titles.map((t) => [t.id, titlePriceBandTier(t.products, t, defaults!)]));
    // A title deleted between the two reads simply drops out.
    const rows = stale.filter((s) => tierById.has(s.id));
    if (rows.length > 0) {
      // Raw UPDATE, not prisma.title.update: Prisma would stamp updatedAt,
      // and a recompute is not an edit (the catalog's "newest" sort reads it).
      written += await prisma.$executeRaw`
        UPDATE "Title" AS t
        SET "priceBandTier" = v.tier, "priceBandComputedRev" = v.rev
        FROM (VALUES ${Prisma.join(
          rows.map((r) => Prisma.sql`(${r.id}, ${tierById.get(r.id)}::int, ${r.rev}::int)`),
        )}) AS v(id, tier, rev)
        WHERE t.id = v.id AND t."priceBandRev" = v.rev`;
    }
    if (stale.length < BATCH) break;
  }
  return written;
}

// The hourly sweep's entry point (instrumentation-node.ts).
export async function runTitlePriceBandSweep(): Promise<string> {
  const written = await refreshStaleTitlePriceBands();
  return `sweep done: recomputed=${written}`;
}
