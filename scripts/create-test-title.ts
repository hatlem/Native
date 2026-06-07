// Disposable sandbox title + FIRM product for scenario testing.
//
// Creates a clearly-labelled, idempotent test publisher/title/product that
// is self-serve FIRM-bookable (active + confirmedAt + visibility=FIRM +
// pricesPublic on both title and publisher) so a real order can be placed
// against it WITHOUT touching real publisher inventory or the live Admirate
// campaign data. Re-runnable. Tear down with `scripts/deactivate-test-title.ts`.
//
// Run: railway run --service Native sh -c \
//   "export DATABASE_URL='<Postgres DATABASE_PUBLIC_URL>'; pnpm tsx scripts/create-test-title.ts"

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PUBLISHER_NAME = "ZZZ TEST — Scenario Sandbox (do not book)";
const TITLE_NAME = "ZZZ TEST — Scenario Sandbox Title (do not book)";
const TITLE_SLUG = "zzz-test-scenario-sandbox";
const PRODUCT_EXTREF = "zzz-test-firm-1";

async function main() {
  const market = await prisma.market.findUnique({ where: { code: "NO" } });
  if (!market) throw new Error("NO market not found");

  const publisher = await prisma.publisher.upsert({
    where: { marketId_name: { marketId: market.id, name: PUBLISHER_NAME } },
    update: { pricesPublic: true },
    create: {
      name: PUBLISHER_NAME,
      countryCode: "NO",
      marketId: market.id,
      pricesPublic: true,
      contractNotes: "Disposable scenario-test publisher. Safe to deactivate.",
    },
  });

  const title = await prisma.title.upsert({
    where: { slug: TITLE_SLUG },
    update: { active: true, pricesPublic: true, publisherId: publisher.id },
    create: {
      name: TITLE_NAME,
      slug: TITLE_SLUG,
      publisherId: publisher.id,
      countryCode: "NO",
      marketId: market.id,
      category: "business",
      audienceNote: "Scenario sandbox — not a real publication.",
      active: true,
      pricesPublic: true,
      description: "Disposable test title for /run-scenarios order testing.",
    },
  });

  const product = await prisma.product.upsert({
    where: { titleId_externalRef: { titleId: title.id, externalRef: PRODUCT_EXTREF } },
    update: {
      active: true,
      bookable: true,
      visibility: "FIRM",
      confirmedAt: new Date(),
      confirmedSource: "scenario-test",
      basePrice: "1000.00",
      currency: market.currency,
    },
    create: {
      titleId: title.id,
      externalRef: PRODUCT_EXTREF,
      type: "NATIVE_ARTICLE",
      name: "Test FIRM Native (sandbox)",
      description: "Disposable FIRM self-serve product for order testing.",
      pricingModel: "FLAT",
      basePrice: "1000.00",
      currency: market.currency,
      visibility: "FIRM",
      leadTimeDays: 10,
      active: true,
      bookable: true,
      confirmedAt: new Date(),
      confirmedSource: "scenario-test",
    },
  });

  // Default price rule (margin 15%, no seasonal, minVolume 1) if absent.
  const existingRule = await prisma.priceRule.findFirst({ where: { productId: product.id } });
  if (!existingRule) {
    await prisma.priceRule.create({
      data: { productId: product.id, label: "default", note: "scenario-test" },
    });
  }

  console.log("Sandbox ready:");
  console.log("  marketCode   NO  currency", market.currency);
  console.log("  publisherId ", publisher.id);
  console.log("  titleId     ", title.id, " slug", TITLE_SLUG);
  console.log("  PRODUCT_ID  ", product.id, " (visibility FIRM, bookable, confirmed)");
  console.log("  catalog url  /no/catalog/" + TITLE_SLUG);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
