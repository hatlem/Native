/**
 * Ingest verified-live UK / NL / BE catalog titles (2026-06-11).
 *
 * Expands the marketplace footprint the user asked for:
 *   - England / Scotland / Wales / Northern Ireland — modelled as
 *     `Title.region` within the existing UK market (no new MarketCode).
 *   - Netherlands (NL) and Belgium (BE) — new EUR markets (enum added by
 *     migration 20260611120000_add_nl_be_markets); Belgium split into
 *     region "Flanders" (Dutch) and "Wallonia" (French) titles.
 *
 * Source data: data/catalog/intl_titles_0611.json — compiled by six parallel
 * research agents, each confirming every title is actively publishing in
 * 2025-2026 on its live website (per docs/catalog-data-standard.md: every
 * row carries a verificationSource URL; "omit if uncertain" applied).
 *
 * Idempotent. Re-runnable without double-effect:
 *   - New markets  -> upsert Market by code (UK already exists).
 *   - Publishers   -> find-or-create per (market, ownerGroup); existing reused.
 *   - New title    -> create, status LIVE + source + date, attached to its
 *                     ownerGroup publisher.
 *   - Existing slug-> ENRICH only: always set region + verificationStatus=LIVE
 *                     + verificationSource + lastVerifiedAt; fill website /
 *                     category / type / frequency / audienceNote / ownerGroup /
 *                     reach / format ONLY when currently empty. Never reassigns
 *                     the publisher, flips `active`, or clobbers curated copy.
 *
 * No products, prices, or contact emails are created — this is step 1 of the
 * pipeline ("title is real & current"); ad-email extraction stays with the
 * outreach pipeline.
 *
 * Run: pnpm tsx scripts/ingest-intl-titles-0611.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, MarketCode, VerificationStatus } from "@prisma/client";

const prisma = new PrismaClient();

const VERIFIED_AT = new Date("2026-06-11T00:00:00.000Z");

type Row = {
  market: "UK" | "NL" | "BE";
  region: string | null;
  name: string;
  websiteUrl: string;
  type: string;
  frequency: string;
  category: string;
  ownerGroup: string | null;
  audienceNote: string;
  verificationSource: string;
};

// Market specs for codes that may not exist yet (UK already seeded). Mirrors
// prisma/seed.ts so a fresh DB and an incremental ingest agree.
const NEW_MARKETS: Record<string, { name: string; disclosure: string; vatRatePct: number }> = {
  NL: { name: "Netherlands", disclosure: "Advertentie / Gesponsord", vatRatePct: 21 },
  BE: { name: "Belgium", disclosure: "Advertentie / Publicité", vatRatePct: 21 },
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const isEmpty = (v: string | null | undefined) => v == null || v.trim() === "";
// Keep curated data; only fall back to the freshly-verified value when empty.
const orKeep = (existing: string | null | undefined, fresh: string | null) =>
  isEmpty(existing) ? fresh : existing!;

const reachFor = (category: string) => (category === "regional-news" ? "Regional" : "National");
const formatFor = (type: string) => (type === "Digital" ? "Digital" : "Print + Digital");

// Controlled vocabularies. The original CSV seed mis-filed frequency words
// ("Daily", "Monthly mag") into `type` and free-text ("National quality",
// "Satire") into `category` for many titles. Per docs/catalog-data-standard.md
// those CSV values are untrustworthy: when an existing value is OUT of vocab we
// replace it with the freshly-verified one; an in-vocab value is left alone.
const VALID_TYPES = new Set(["Avis", "Magazine", "Digital"]);
const VALID_CATEGORIES = new Set([
  "general-news", "regional-news", "business", "finance", "lifestyle", "women",
  "sport", "entertainment", "tv-film", "science-tech", "culture", "food",
  "home-garden", "fashion", "music", "current-affairs", "news-weekly",
  "trade-b2b", "motoring", "health", "travel", "celebrity",
]);
// Keep an in-vocab existing value; otherwise take the verified fresh one.
const normalize = (existing: string | null | undefined, fresh: string, vocab: Set<string>) =>
  existing != null && vocab.has(existing) ? existing : fresh;

async function ensureMarket(code: string): Promise<{ id: string; currency: string }> {
  const spec = NEW_MARKETS[code];
  const market = await prisma.market.upsert({
    where: { code: code as MarketCode },
    update: {},
    create: {
      code: code as MarketCode,
      name: spec.name,
      currency: "EUR",
      defaultLocale: "en",
      vatRatePct: spec.vatRatePct,
      disclosureLabel: spec.disclosure,
      fxToEUR: null,
    },
    select: { id: true, currency: true },
  });
  return market;
}

async function main() {
  const raw = readFileSync(
    join(process.cwd(), "data", "catalog", "intl_titles_0611.json"),
    "utf8",
  );
  const rows: Row[] = JSON.parse(raw).titles;
  console.log(`Loaded ${rows.length} verified titles from data file.\n`);

  // 1) Markets. UK exists; ensure NL/BE.
  const marketIds = new Map<string, string>();
  for (const code of ["UK", "NL", "BE"] as const) {
    if (code === "UK") {
      const uk = await prisma.market.findUnique({
        where: { code: MarketCode.UK },
        select: { id: true },
      });
      if (!uk) throw new Error("Market UK not found — run prisma seed first.");
      marketIds.set("UK", uk.id);
    } else {
      const m = await ensureMarket(code);
      marketIds.set(code, m.id);
      console.log(`Market ${code} ready (${NEW_MARKETS[code].name}).`);
    }
  }
  console.log("");

  // 2) Publisher find-or-create cache, keyed by `${market}|${publisherName}`.
  const pubCache = new Map<string, string>();
  async function publisherId(market: string, name: string): Promise<string> {
    const key = `${market}|${name}`;
    const cached = pubCache.get(key);
    if (cached) return cached;
    const marketId = marketIds.get(market)!;
    // Publisher is unique on (marketId, name).
    const existing = await prisma.publisher.findFirst({
      where: { marketId, name },
      select: { id: true },
    });
    const id =
      existing?.id ??
      (
        await prisma.publisher.create({
          data: { name, countryCode: market, marketId },
          select: { id: true },
        })
      ).id;
    pubCache.set(key, id);
    return id;
  }

  let created = 0;
  let enriched = 0;
  const perBucket = new Map<string, { created: number; enriched: number }>();

  for (const r of rows) {
    const slug = `${slugify(r.name)}-${r.market.toLowerCase()}`;
    const marketId = marketIds.get(r.market)!;
    const bucket = `${r.market}/${r.region ?? "-"}`;
    if (!perBucket.has(bucket)) perBucket.set(bucket, { created: 0, enriched: 0 });

    const existing = await prisma.title.findUnique({
      where: { slug },
      select: {
        id: true,
        websiteUrl: true,
        category: true,
        type: true,
        frequency: true,
        audienceNote: true,
        ownerGroup: true,
        reach: true,
        format: true,
      },
    });

    if (existing) {
      // ENRICH ONLY — never reassign publisher or flip active.
      await prisma.title.update({
        where: { id: existing.id },
        data: {
          region: r.region,
          verificationStatus: VerificationStatus.LIVE,
          verificationSource: r.verificationSource,
          lastVerifiedAt: VERIFIED_AT,
          websiteUrl: orKeep(existing.websiteUrl, r.websiteUrl),
          category: normalize(existing.category, r.category, VALID_CATEGORIES),
          type: normalize(existing.type, r.type, VALID_TYPES),
          frequency: orKeep(existing.frequency, r.frequency),
          audienceNote: orKeep(existing.audienceNote, r.audienceNote),
          ownerGroup: orKeep(existing.ownerGroup, r.ownerGroup),
          reach: orKeep(existing.reach, reachFor(r.category)),
          format: orKeep(existing.format, formatFor(r.type)),
        },
      });
      enriched++;
      perBucket.get(bucket)!.enriched++;
    } else {
      const pubName = r.ownerGroup ?? r.name;
      const pubId = await publisherId(r.market, pubName);
      await prisma.title.create({
        data: {
          name: r.name,
          slug,
          publisherId: pubId,
          marketId,
          countryCode: r.market,
          region: r.region,
          category: r.category,
          type: r.type,
          frequency: r.frequency,
          ownerGroup: r.ownerGroup,
          publisherName: pubName,
          audienceNote: r.audienceNote,
          websiteUrl: r.websiteUrl,
          reach: reachFor(r.category),
          format: formatFor(r.type),
          active: true,
          verificationStatus: VerificationStatus.LIVE,
          verificationSource: r.verificationSource,
          lastVerifiedAt: VERIFIED_AT,
        },
      });
      created++;
      perBucket.get(bucket)!.created++;
    }
  }

  console.log("Per region (created / enriched):");
  for (const [bucket, c] of [...perBucket.entries()].sort()) {
    console.log(`  ${bucket.padEnd(22)} ${c.created} created / ${c.enriched} enriched`);
  }
  console.log(`\nTotal: ${created} created, ${enriched} enriched (${created + enriched} titles).`);

  // Verification — counts the buyer catalog would see (active LIVE titles).
  for (const code of ["UK", "NL", "BE"] as const) {
    const live = await prisma.title.count({
      where: { market: { code }, active: true, verificationStatus: VerificationStatus.LIVE },
    });
    console.log(`  ${code}: ${live} active LIVE titles total`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
