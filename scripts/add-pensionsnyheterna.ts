/**
 * Add Pensionsnyheterna to the catalog.
 *
 * Surfaced by Marie's scenario run (Vide Pension AB regulated SE
 * launch): the niche Swedish pension trade-press title that's
 * table-stakes for a B2B tjänstepension campaign was missing from
 * the catalog. This is a single-publisher, single-title, single-
 * product insert — idempotent so we can re-run safely.
 *
 * Run: pnpm tsx scripts/add-pensionsnyheterna.ts
 */

import {
  PrismaClient,
  MarketCode,
  ProductType,
  PriceVisibility,
} from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const market = await prisma.market.findUnique({
    where: { code: MarketCode.SE },
    select: { id: true, currency: true },
  });
  if (!market) {
    throw new Error("Market SE not found — run prisma seed first.");
  }

  // Publishers have no unique constraint on (name, countryCode), so
  // find-or-create explicitly.
  const existing = await prisma.publisher.findFirst({
    where: { name: "Pensionsnyheterna", countryCode: "SE" },
    select: { id: true },
  });
  const publisher = existing
    ? await prisma.publisher.update({
        where: { id: existing.id },
        data: {
          marketId: market.id,
          paymentTerms: "net 30",
          contactEmail: "annons@pensionsnyheterna.se",
        },
      })
    : await prisma.publisher.create({
        data: {
          name: "Pensionsnyheterna",
          countryCode: "SE",
          marketId: market.id,
          paymentTerms: "net 30",
          contactEmail: "annons@pensionsnyheterna.se",
        },
      });
  console.log(`Publisher: ${publisher.name} (id=${publisher.id})`);

  const title = await prisma.title.upsert({
    where: { slug: "pensionsnyheterna-se" },
    update: {
      // Don't overwrite reach if it's already curated higher than this
      // estimate — just ensure the title is active and pointing at the
      // right publisher/market.
      publisherId: publisher.id,
      marketId: market.id,
      countryCode: "SE",
      active: true,
    },
    create: {
      name: "Pensionsnyheterna",
      slug: "pensionsnyheterna-se",
      publisherId: publisher.id,
      marketId: market.id,
      countryCode: "SE",
      category: "Pension",
      vertical: "B2B – Pension & Insurance",
      audienceNote:
        "HR-, ekonomi- och pensionsbeslutsfattare på svenska arbetsgivare; aktörer inom tjänstepensionsbranschen (försäkringsbolag, fondförvaltare, valbolag, rådgivare).",
      // Conservative estimate for a niche B2B trade title. Replace with
      // the publisher's actual figure once they share it.
      digitalReach: 18_000,
      nativeFit: "High",
      b2bB2c: "B2B",
      active: true,
      lastVerifiedAt: null,
      websiteUrl: "https://pensionsnyheterna.se",
    },
  });
  console.log(`Title:     ${title.name} (slug=${title.slug})`);

  const existingProduct = await prisma.product.findFirst({
    where: { titleId: title.id, type: ProductType.NATIVE_ARTICLE, active: true },
    select: { id: true },
  });

  const product = existingProduct
    ? await prisma.product.update({
        where: { id: existingProduct.id },
        data: {
          // Leave price alone if the desk has already set one; only
          // ensure it's a contactable INDICATIVE-visible product. If
          // the row was created without a basePrice this update is a
          // no-op.
          visibility: PriceVisibility.INDICATIVE,
          leadTimeDays: 14,
        },
      })
    : await prisma.product.create({
        data: {
          titleId: title.id,
          type: ProductType.NATIVE_ARTICLE,
          name: "Native-artikel i Pensionsnyheterna",
          description:
            "Redaktionsnära native-artikel (1 500–2 500 ord) i Pensionsnyheterna, publicerad med 'Annons / Sponsrat innehåll'-märkning enligt FI/Konsumentverkets riktlinjer.",
          basePrice: 48_000,
          currency: market.currency,
          // INDICATIVE visibility, but no confirmedAt — the catalog
          // page's isProductPriceShown gate hides the number until
          // sales confirms a real rate-card price with the publisher.
          // Net effect: title surfaces in search, card shows "Kontakt
          // för pris", buyer routes through the desk RFQ flow. The
          // basePrice we seed here is a desk-internal estimate only.
          visibility: PriceVisibility.INDICATIVE,
          leadTimeDays: 14,
          active: true,
          bookable: false,
        },
      });
  console.log(`Product:   ${product.name} (id=${product.id})`);

  // Verify it's discoverable through the same search the buyer-side
  // catalog page uses — name ILIKE search via Prisma.
  const verifyCount = await prisma.title.count({
    where: {
      market: { code: "SE" },
      OR: [{ name: { contains: "Pensionsnyheterna", mode: "insensitive" } }],
    },
  });
  console.log(`\nCatalog search verification (market=SE, q=Pensionsnyheterna): ${verifyCount} title(s) found.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
