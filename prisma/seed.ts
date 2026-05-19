import {
  PrismaClient,
  MarketCode,
  ProductType,
  PriceVisibility,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DESK_EMAIL = (
  process.env.DESK_ADMIN_EMAIL || "desk@benative.example"
).toLowerCase();
const DESK_PASSWORD = process.env.DESK_ADMIN_PASSWORD || "benative-desk";
const PUB_EMAIL = (
  process.env.PUBLISHER_EMAIL || "publisher@benative.example"
).toLowerCase();
const PUB_PASSWORD = process.env.PUBLISHER_PASSWORD || "benative-pub";
const BUYER_EMAIL = (
  process.env.BUYER_EMAIL || "buyer@benative.example"
).toLowerCase();
const BUYER_PASSWORD = process.env.BUYER_PASSWORD || "benative-buyer";
const BUYER_ORG = "Demo Advertiser AS";
const AGENCY_EMAIL = (
  process.env.AGENCY_EMAIL || "agency@benative.example"
).toLowerCase();
const AGENCY_PASSWORD = process.env.AGENCY_PASSWORD || "benative-agency";
const AGENCY_ORG = "Demo Media Agency";

type SeedMarket = {
  code: MarketCode;
  name: string;
  currency: string;
  defaultLocale: string;
  disclosure: string;
};

const MARKETS: SeedMarket[] = [
  {
    code: MarketCode.NO,
    name: "Norway",
    currency: "NOK",
    defaultLocale: "no",
    disclosure: "Annonsørinnhold",
  },
  {
    code: MarketCode.SE,
    name: "Sweden",
    currency: "SEK",
    defaultLocale: "sv",
    disclosure: "Annons",
  },
  {
    code: MarketCode.DK,
    name: "Denmark",
    currency: "DKK",
    defaultLocale: "da",
    disclosure: "Annonce / Sponsoreret indhold",
  },
];

type SeedTitle = {
  name: string;
  category: string;
  monthlyReach: number;
};

const PUBLISHERS: {
  market: MarketCode;
  name: string;
  paymentTerms: string;
  titles: SeedTitle[];
}[] = [
  {
    market: MarketCode.NO,
    name: "Schibsted",
    paymentTerms: "net 30",
    titles: [
      { name: "Aftenposten", category: "general-news", monthlyReach: 1_200_000 },
      { name: "VG", category: "general-news", monthlyReach: 2_000_000 },
      { name: "E24", category: "business", monthlyReach: 600_000 },
    ],
  },
  {
    market: MarketCode.NO,
    name: "Amedia",
    paymentTerms: "net 30",
    titles: [
      { name: "Nettavisen", category: "general-news", monthlyReach: 900_000 },
    ],
  },
  {
    market: MarketCode.SE,
    name: "Bonnier News",
    paymentTerms: "net 30",
    titles: [
      {
        name: "Dagens Nyheter",
        category: "general-news",
        monthlyReach: 1_500_000,
      },
      {
        name: "Dagens industri",
        category: "business",
        monthlyReach: 700_000,
      },
    ],
  },
  {
    market: MarketCode.SE,
    name: "Schibsted Sverige",
    paymentTerms: "net 30",
    titles: [
      { name: "Aftonbladet", category: "general-news", monthlyReach: 2_500_000 },
    ],
  },
  {
    market: MarketCode.DK,
    name: "JP/Politikens Hus",
    paymentTerms: "net 30",
    titles: [
      { name: "Politiken", category: "general-news", monthlyReach: 800_000 },
      {
        name: "Jyllands-Posten",
        category: "general-news",
        monthlyReach: 700_000,
      },
    ],
  },
  {
    market: MarketCode.DK,
    name: "Berlingske Media",
    paymentTerms: "net 30",
    titles: [
      { name: "Berlingske", category: "business", monthlyReach: 500_000 },
    ],
  },
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

type RateCardTier = {
  label: string;
  minVolume: number;
  marginPct: number;
  seasonalMultiplier: number;
};

const PRODUCT_BLUEPRINT: {
  type: ProductType;
  perThousandReach: number;
  leadTimeDays: number;
  visibility: PriceVisibility;
  rateCard: RateCardTier[];
}[] = [
  {
    type: ProductType.NATIVE_ARTICLE,
    perThousandReach: 25,
    leadTimeDays: 12,
    visibility: PriceVisibility.INDICATIVE,
    rateCard: [
      { label: "standard", minVolume: 1, marginPct: 22, seasonalMultiplier: 1 },
      // Editorial series — volume discount from 3 placements.
      { label: "series", minVolume: 3, marginPct: 18, seasonalMultiplier: 1 },
    ],
  },
  {
    type: ProductType.ADVERTORIAL,
    perThousandReach: 18,
    leadTimeDays: 10,
    visibility: PriceVisibility.INDICATIVE,
    rateCard: [
      { label: "standard", minVolume: 1, marginPct: 18, seasonalMultiplier: 1 },
      { label: "series", minVolume: 3, marginPct: 15, seasonalMultiplier: 1 },
    ],
  },
  // Standardised display inventory is firm-priced -> self-serve instant book.
  // Carries a high-season premium; bulk buyers get a better margin.
  {
    type: ProductType.NATIVE_DISPLAY,
    perThousandReach: 12,
    leadTimeDays: 7,
    visibility: PriceVisibility.FIRM,
    rateCard: [
      {
        label: "standard",
        minVolume: 1,
        marginPct: 12,
        seasonalMultiplier: 1.1,
      },
      { label: "bulk", minVolume: 5, marginPct: 9, seasonalMultiplier: 1.1 },
    ],
  },
];

async function main() {
  // Clean catalog tables for an idempotent reseed (no commerce data yet).
  await prisma.priceRule.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.product.deleteMany();
  await prisma.title.deleteMany();
  await prisma.publisher.deleteMany();
  await prisma.market.deleteMany();

  for (const m of MARKETS) {
    const market = await prisma.market.create({
      data: {
        code: m.code,
        name: m.name,
        currency: m.currency,
        defaultLocale: m.defaultLocale,
        vatRatePct: 25,
      },
    });

    const publishers = PUBLISHERS.filter((p) => p.market === m.code);
    for (const p of publishers) {
      const publisher = await prisma.publisher.create({
        data: {
          name: p.name,
          marketId: market.id,
          paymentTerms: p.paymentTerms,
          contactEmail: `sales@${slugify(p.name)}.example`,
        },
      });

      for (const titleSeed of p.titles) {
        const title = await prisma.title.create({
          data: {
            name: titleSeed.name,
            slug: slugify(`${titleSeed.name}-${m.code}`),
            publisherId: publisher.id,
            marketId: market.id,
            category: titleSeed.category,
            monthlyReach: titleSeed.monthlyReach,
            websiteUrl: `https://www.${slugify(titleSeed.name)}.example`,
            lastVerifiedAt: new Date(),
          },
        });

        for (const bp of PRODUCT_BLUEPRINT) {
          const basePrice = Math.round(
            (titleSeed.monthlyReach / 1000) * bp.perThousandReach,
          );
          const product = await prisma.product.create({
            data: {
              titleId: title.id,
              type: bp.type,
              name: `${titleSeed.name} — ${bp.type}`,
              currency: m.currency,
              basePrice,
              visibility: bp.visibility,
              leadTimeDays: bp.leadTimeDays,
              priceRules: {
                create: bp.rateCard.map((rc) => ({
                  label: rc.label,
                  minVolume: rc.minVolume,
                  marginPct: rc.marginPct,
                  seasonalMultiplier: rc.seasonalMultiplier,
                })),
              },
              spec: {
                create: {
                  wordCountMin:
                    bp.type === ProductType.NATIVE_DISPLAY ? null : 500,
                  wordCountMax:
                    bp.type === ProductType.NATIVE_DISPLAY ? null : 900,
                  imagesMin: 2,
                  disclosureLabel: m.disclosure,
                  fileFormats: "JPG, PNG",
                  requirements:
                    "Clearly marked as paid; editorial-quality copy aligned to the title's house style.",
                },
              },
            },
          });
          void product;
        }
      }
    }
  }

  const passwordHash = await bcrypt.hash(DESK_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: DESK_EMAIL },
    update: { passwordHash, role: "DESK" },
    create: {
      email: DESK_EMAIL,
      name: "Desk Admin",
      role: "DESK",
      passwordHash,
    },
  });

  const pubPublisher = await prisma.publisher.findFirst({
    where: { name: "Schibsted" },
  });
  if (pubPublisher) {
    const pubHash = await bcrypt.hash(PUB_PASSWORD, 10);
    await prisma.user.upsert({
      where: { email: PUB_EMAIL },
      update: {
        passwordHash: pubHash,
        role: "PUBLISHER",
        publisherId: pubPublisher.id,
      },
      create: {
        email: PUB_EMAIL,
        name: "Publisher Admin",
        role: "PUBLISHER",
        passwordHash: pubHash,
        publisherId: pubPublisher.id,
      },
    });
  }

  let buyerOrg = await prisma.organization.findFirst({
    where: { name: BUYER_ORG },
  });
  buyerOrg ??= await prisma.organization.create({
    data: { name: BUYER_ORG, type: "ADVERTISER", marketCode: MarketCode.NO },
  });
  const buyerHash = await bcrypt.hash(BUYER_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: BUYER_EMAIL },
    update: {
      passwordHash: buyerHash,
      role: "BUYER",
      organizationId: buyerOrg.id,
    },
    create: {
      email: BUYER_EMAIL,
      name: "Demo Buyer",
      role: "BUYER",
      passwordHash: buyerHash,
      organizationId: buyerOrg.id,
    },
  });

  // Agency workspace: an AGENCY org managing two advertiser clients.
  let agencyOrg = await prisma.organization.findFirst({
    where: { name: AGENCY_ORG },
  });
  agencyOrg ??= await prisma.organization.create({
    data: { name: AGENCY_ORG, type: "AGENCY", marketCode: MarketCode.NO },
  });
  const agencyHash = await bcrypt.hash(AGENCY_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: AGENCY_EMAIL },
    update: {
      passwordHash: agencyHash,
      role: "ORG_ADMIN",
      organizationId: agencyOrg.id,
    },
    create: {
      email: AGENCY_EMAIL,
      name: "Agency Admin",
      role: "ORG_ADMIN",
      passwordHash: agencyHash,
      organizationId: agencyOrg.id,
    },
  });
  const agencyClients: [string, MarketCode][] = [
    ["Client One AS", MarketCode.NO],
    ["Client Two AB", MarketCode.SE],
  ];
  for (const [cname, mc] of agencyClients) {
    const exists = await prisma.organization.findFirst({
      where: { name: cname, parentOrgId: agencyOrg.id },
    });
    if (!exists) {
      await prisma.organization.create({
        data: {
          name: cname,
          type: "ADVERTISER",
          marketCode: mc,
          parentOrgId: agencyOrg.id,
        },
      });
    }
  }

  const titleCount = await prisma.title.count();
  const productCount = await prisma.product.count();
  console.log(
    `Seeded ${MARKETS.length} markets, ${titleCount} titles, ${productCount} products, desk user ${DESK_EMAIL}, publisher user ${PUB_EMAIL}, buyer user ${BUYER_EMAIL}, agency user ${AGENCY_EMAIL}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
