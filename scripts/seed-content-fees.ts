// Idempotent ops script: ensure default ContentFeeRule rows exist without
// touching the rest of the catalog (the full `db:seed` is destructive and
// prod never runs it). Safe to run against dev or prod. Skips entirely if
// any content-fee rules already exist so it never clobbers desk edits.
//
//   pnpm tsx scripts/seed-content-fees.ts
//
// Amounts are PLACEHOLDERS — tune them in /desk/content-fees.

import { PrismaClient, MarketCode, ProductType } from "@prisma/client";

const prisma = new PrismaClient();

const MARKET_CURRENCY: Record<MarketCode, string> = {
  NO: "NOK",
  SE: "SEK",
  DK: "DKK",
  FI: "EUR",
  DE: "EUR",
  AT: "EUR",
  CH: "CHF",
  UK: "GBP",
  IE: "EUR",
};

async function main() {
  const existing = await prisma.contentFeeRule.count();
  if (existing > 0) {
    console.log(`ContentFeeRule already has ${existing} rows — skipping.`);
    return;
  }

  const rows = (Object.keys(MARKET_CURRENCY) as MarketCode[]).flatMap((code) => {
    const currency = MARKET_CURRENCY[code];
    const krone = currency === "NOK" || currency === "SEK" || currency === "DKK";
    return [
      {
        marketCode: code,
        productType: null,
        currency,
        greenfieldFee: krone ? 8000 : 800,
        adaptationFee: krone ? 4000 : 400,
        note: "Seed placeholder — set real production cost in /desk/content-fees.",
      },
      {
        marketCode: code,
        productType: ProductType.NATIVE_ARTICLE,
        currency,
        greenfieldFee: krone ? 12000 : 1200,
        adaptationFee: krone ? 6000 : 600,
        note: "Seed placeholder — editorial native article.",
      },
    ];
  });

  await prisma.contentFeeRule.createMany({ data: rows });
  console.log(`Inserted ${rows.length} content-fee rules.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
