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

const PRODUCT_BLUEPRINT: {
  type: ProductType;
  perThousandReach: number;
  leadTimeDays: number;
  visibility: PriceVisibility;
}[] = [
  {
    type: ProductType.NATIVE_ARTICLE,
    perThousandReach: 25,
    leadTimeDays: 12,
    visibility: PriceVisibility.INDICATIVE,
  },
  {
    type: ProductType.ADVERTORIAL,
    perThousandReach: 18,
    leadTimeDays: 10,
    visibility: PriceVisibility.INDICATIVE,
  },
  // Standardised display inventory is firm-priced -> self-serve instant book.
  {
    type: ProductType.NATIVE_DISPLAY,
    perThousandReach: 12,
    leadTimeDays: 7,
    visibility: PriceVisibility.FIRM,
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
                create: {
                  label: "default",
                  marginPct: 15,
                  seasonalMultiplier: 1,
                },
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

  const titleCount = await prisma.title.count();
  const productCount = await prisma.product.count();
  console.log(
    `Seeded ${MARKETS.length} markets, ${titleCount} titles, ${productCount} products, desk user ${DESK_EMAIL}, publisher user ${PUB_EMAIL}.`,
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
