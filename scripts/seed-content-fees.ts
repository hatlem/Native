// Idempotent ops script: ensure default ContentFeeRule rows exist without
// touching the rest of the catalog (the full `db:seed` is destructive and
// prod never runs it). Safe to run against dev or prod. Skips entirely if
// any content-fee rules already exist so it never clobbers desk edits.
//
//   pnpm tsx scripts/seed-content-fees.ts
//
// One rule per market, the same article fee for every format (print and
// digital alike) — src/lib/pricing/default-fee-rules.ts. Tune the amounts in
// /desk/content-fees.

import { PrismaClient, MarketCode } from "@prisma/client";
import { MARKET_CURRENCIES, defaultContentFeeRules } from "../src/lib/pricing/default-fee-rules";

const prisma = new PrismaClient();

// Every market code in the schema, so a newly added market fails to typecheck
// here until it has a currency.
const MARKET_CURRENCY: Record<MarketCode, string> = MARKET_CURRENCIES;

async function main() {
  const existing = await prisma.contentFeeRule.count();
  if (existing > 0) {
    console.log(`ContentFeeRule already has ${existing} rows — skipping.`);
    return;
  }

  const rows = defaultContentFeeRules(
    (Object.keys(MARKET_CURRENCY) as MarketCode[]).map((code) => ({ code, currency: MARKET_CURRENCY[code] })),
  ).map((r) => ({ ...r, marketCode: r.marketCode as MarketCode }));

  await prisma.contentFeeRule.createMany({ data: rows });
  console.log(`Inserted ${rows.length} content-fee rules.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
