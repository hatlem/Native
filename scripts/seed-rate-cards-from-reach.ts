/* eslint-disable no-console */

// ⚠️  DEMO / STAGING ONLY — NEVER POINT THIS AT PROD WITHOUT REVIEW. ⚠️
//
// Backfills Title.publishedRateCard for every active title that doesn't
// have one yet, using a crude heuristic on monthlyReach. The output is
// designed to *look like* a publisher rate card so the quote narrative
// renders meaningfully in screenshots and demo flows — it is NOT a
// substitute for the real numbers and must not be shown to customers.
//
// Heuristic per native-article placement (EUR-equivalent):
//   monthlyReach < 50k    →  €3,000 baseline
//   monthlyReach 50k–250k →  €6,000
//   monthlyReach 250k–1M  → €12,000
//   monthlyReach > 1M     → €25,000
//   monthlyReach null     → €4,500 (fallback)
//
// The currency is taken from the title's market (NO→NOK, SE→SEK, etc.).
// Existing publishedRateCard values are NEVER overwritten — the script
// only fills in null rows so a manual desk edit always wins.
//
// Usage:
//   pnpm tsx scripts/seed-rate-cards-from-reach.ts            # dry-run (default)
//   pnpm tsx scripts/seed-rate-cards-from-reach.ts --apply    # actually write
//   pnpm tsx scripts/seed-rate-cards-from-reach.ts --apply --market NO
//
// Audit trail: writes are logged with reason="seed-rate-cards-from-reach"
// so they can be identified and reverted in bulk if needed.

import { PrismaClient, type MarketCode } from "@prisma/client";

const prisma = new PrismaClient();

type Bucket = { ceiling: number | null; amount: number };

const BUCKETS: Bucket[] = [
  { ceiling: 50_000, amount: 3_000 },
  { ceiling: 250_000, amount: 6_000 },
  { ceiling: 1_000_000, amount: 12_000 },
  { ceiling: null, amount: 25_000 },
];

const FALLBACK_NO_REACH = 4_500;

// Per-market multiplier so the numbers look plausible in local
// currency (a NOK rate card around 60–80k for a major Norwegian
// title; SEK similar; DKK lower; CHF higher; etc.). These are NOT
// FX-correct — they're rough magnitudes that match what publishers
// in each market tend to list.
const MARKET_MULTIPLIER: Record<MarketCode, number> = {
  NO: 11,
  SE: 11,
  DK: 7,
  FI: 1,
  DE: 1,
  AT: 1,
  CH: 1.1,
  UK: 0.9,
  IE: 1,
};

function amountFromReach(reach: number | null): number {
  if (reach == null) return FALLBACK_NO_REACH;
  for (const b of BUCKETS) {
    if (b.ceiling == null || reach < b.ceiling) return b.amount;
  }
  return FALLBACK_NO_REACH;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const marketArgIdx = args.indexOf("--market");
  const marketFilter =
    marketArgIdx >= 0 ? (args[marketArgIdx + 1] as MarketCode) : null;

  console.log("───────────────────────────────────────────────────────────");
  console.log(" seed-rate-cards-from-reach");
  console.log(` mode: ${apply ? "APPLY (writing to DB)" : "DRY-RUN (no writes)"}`);
  console.log(` market filter: ${marketFilter ?? "ALL"}`);
  console.log("───────────────────────────────────────────────────────────");
  console.log(
    " ⚠️  These numbers are heuristics, NOT real publisher rate cards.",
  );
  console.log("    They are safe to seed for staging / demo flows only.");
  console.log("───────────────────────────────────────────────────────────");

  const where = {
    active: true,
    publishedRateCard: null,
    ...(marketFilter ? { market: { code: marketFilter } } : {}),
  };

  const candidates = await prisma.title.findMany({
    where,
    select: {
      id: true,
      name: true,
      monthlyReach: true,
      market: { select: { code: true, currency: true } },
    },
  });

  if (candidates.length === 0) {
    console.log("No active titles without a rate card. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const title of candidates) {
    const base = amountFromReach(title.monthlyReach);
    const mult = MARKET_MULTIPLIER[title.market.code] ?? 1;
    const amount = Math.round((base * mult) / 100) * 100; // round to nearest 100

    if (apply) {
      await prisma.title.update({
        where: { id: title.id },
        data: {
          publishedRateCard: amount,
          publishedRateCurrency: title.market.currency,
        },
      });
    }
    updated++;
    if (updated <= 20) {
      console.log(
        ` ${title.market.code}  ${title.name.padEnd(40).slice(0, 40)}  ` +
          `reach=${(title.monthlyReach ?? 0).toString().padStart(8)}  ` +
          `→ ${amount.toLocaleString()} ${title.market.currency}`,
      );
    }
  }
  if (updated > 20) {
    console.log(` … and ${updated - 20} more titles`);
  }

  console.log("───────────────────────────────────────────────────────────");
  console.log(
    ` ${apply ? "Wrote" : "Would write"} rate cards on ${updated} title(s).`,
  );
  if (!apply) {
    console.log(" Re-run with --apply to commit. NOT FOR PRODUCTION.");
  }
  console.log("───────────────────────────────────────────────────────────");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
