// Cached data behind the public, signed-out catalog surfaces: the landing
// page's showcase and the catalog gate.
//
// Both pages are the first thing a visitor (or a crawler) hits, and both ran
// their queries on every request — the landing page loaded every publisher
// with every one of its titles (~1,900 × ~3,100 rows) only to keep the eight
// largest. None of it is per-visitor and it changes only when the catalog is
// curated, so it is computed once and shared across requests. Refreshed
//   - on a 5-minute timer, and
//   - at once when a title's catalog visibility changes — these entries carry
//     the same tag as the filter-rail lookups (invalidateCatalogFacets).
//
// Cached values are JSON, so each loader returns plain data (numbers and
// strings), never Prisma Decimals or Dates.
import { unstable_cache } from "next/cache";
import { Prisma, type ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CATALOG_FACETS_TAG, CATALOG_TITLES_TAG } from "@/lib/catalog-facets";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";
import { SUPPORTED_MARKETS } from "@/lib/markets";

const REVALIDATE_SECONDS = 300;
const opts = { tags: [CATALOG_FACETS_TAG], revalidate: REVALIDATE_SECONDS };

// unstable_cache needs Next's request machinery; scripts and unit tests run
// without it, so they get the plain loader.
function shared<T>(key: string, load: () => Promise<T>): () => Promise<T> {
  const cached = unstable_cache(load, [key], opts);
  return () => (process.env.NEXT_RUNTIME ? cached() : load());
}

// What a verified buyer can browse — the one count every surface quotes.
export const cachedCatalogTitleCount = shared("catalog-public:title-count", () =>
  prisma.title.count({ where: catalogVisibleTitleWhere }),
);

export type LandingShowcase = {
  sampleTitles: Array<{
    id: string;
    name: string;
    monthlyReach: number | null;
    publisherName: string;
    marketCode: string;
    productType: ProductType | null;
  }>;
  topPublishers: Array<{ id: string; name: string; markets: string[]; count: number }>;
  totalPublishers: number;
};

export const cachedLandingShowcase = shared(
  "catalog-public:landing-showcase",
  async (): Promise<LandingShowcase> => {
    const [sampleTitles, perPublisherMarket, totalPublishers] = await Promise.all([
      prisma.title.findMany({
        where: {
          active: true,
          products: { some: { active: true, visibility: "INDICATIVE" } },
          monthlyReach: { not: null },
        },
        // Biggest audiences first. Postgres sorts NULLs FIRST on DESC, which
        // filled this strip with the alphabetically-first titles that have no
        // reach figure ("Aamuset — readers"); the showcase needs the number.
        orderBy: [{ monthlyReach: { sort: "desc", nulls: "last" } }, { name: "asc" }],
        take: 8,
        select: {
          id: true,
          name: true,
          monthlyReach: true,
          publisher: { select: { name: true } },
          market: { select: { code: true } },
          products: {
            where: { active: true, visibility: "INDICATIVE" },
            orderBy: { basePrice: "asc" },
            take: 1,
            select: { type: true },
          },
        },
      }),
      // Titles per publisher and market, counted in the database instead of
      // loading every title row.
      prisma.title.groupBy({ by: ["publisherId", "marketId"], _count: { _all: true } }),
      prisma.publisher.count(),
    ]);

    const byPublisher = new Map<string, { count: number; marketIds: Set<string> }>();
    for (const row of perPublisherMarket) {
      const entry = byPublisher.get(row.publisherId) ?? { count: 0, marketIds: new Set<string>() };
      entry.count += row._count._all;
      entry.marketIds.add(row.marketId);
      byPublisher.set(row.publisherId, entry);
    }
    const [publishers, markets] = await Promise.all([
      prisma.publisher.findMany({
        // Universitetsforlaget is an academic press (~75 scholarly journals)
        // that tops the showcase by raw title count but doesn't represent the
        // native-ad publishers we want to feature. Keep its titles in the
        // catalog — just exclude it from this landing strip.
        where: {
          id: { in: [...byPublisher.keys()] },
          NOT: { name: { startsWith: "Universitetsforlaget" } },
        },
        select: { id: true, name: true },
      }),
      prisma.market.findMany({ select: { id: true, code: true } }),
    ]);
    const marketCode = new Map(markets.map((m) => [m.id, m.code.toLowerCase()]));
    const topPublishers = publishers
      .map((p) => {
        const entry = byPublisher.get(p.id)!;
        return {
          id: p.id,
          name: p.name,
          markets: [...entry.marketIds]
            .map((id) => marketCode.get(id))
            .filter((code): code is string => !!code)
            .sort(),
          count: entry.count,
        };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8);

    return {
      sampleTitles: sampleTitles.map((t) => ({
        id: t.id,
        name: t.name,
        monthlyReach: t.monthlyReach,
        publisherName: t.publisher.name,
        marketCode: t.market.code,
        productType: t.products[0]?.type ?? null,
      })),
      topPublishers,
      totalPublishers,
    };
  },
);

export type CatalogGateData = {
  productCount: number;
  distinctMarkets: number;
  featured: Array<{
    id: string;
    name: string;
    category: string;
    vertical: string | null;
    publisherName: string;
    marketCode: string;
  }>;
};

export const cachedCatalogGate = shared(
  "catalog-public:gate",
  async (): Promise<CatalogGateData> => {
    const [productCount, distinctMarkets, featured] = await Promise.all([
      prisma.product.count({ where: { active: true } }),
      // Markets the catalog actually sells in: the served nine that have
      // titles. Prod still holds active titles in NL/BE (MarketCode enum
      // leftovers, see @/lib/markets), which made this read "11 markets"
      // next to every other surface's 9.
      prisma.title
        .findMany({
          where: {
            ...catalogVisibleTitleWhere,
            market: { code: { in: [...SUPPORTED_MARKETS] } },
          },
          select: { marketId: true },
          distinct: ["marketId"],
        })
        .then((rows) => rows.length),
      prisma.title.findMany({
        where: { active: true, monthlyReach: { not: null } },
        // NULLS LAST: Postgres puts nulls first on DESC (see the home page).
        orderBy: [{ monthlyReach: { sort: "desc", nulls: "last" } }, { name: "asc" }],
        take: 6,
        select: {
          id: true,
          name: true,
          category: true,
          vertical: true,
          publisher: { select: { name: true } },
          market: { select: { code: true } },
        },
      }),
    ]);
    return {
      productCount,
      distinctMarkets,
      featured: featured.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        vertical: t.vertical,
        publisherName: t.publisher.name,
        marketCode: t.market.code,
      })),
    };
  },
);

// ---------------------------------------------------------------------------
// Title page (/catalog/<slug>): the title, its publisher and market and its
// active products with their price rules and spec — the same for every
// buyer (who has hearted it, and which lists hold it, stays per request).
// Shared across requests for a minute; expired at once by any write through
// invalidateCatalogTitles (the desk's title actions, publisher rate edits,
// quote pricing) and by invalidateCatalogFacets.

const titlePageInclude = {
  publisher: true,
  market: true,
  products: {
    where: { active: true },
    include: { priceRules: true, spec: true },
  },
} satisfies Prisma.TitleInclude;

export type TitlePageData = Prisma.TitleGetPayload<{ include: typeof titlePageInclude }>;

function loadTitlePageData(slug: string): Promise<TitlePageData | null> {
  return prisma.title.findUnique({ where: { slug }, include: titlePageInclude });
}

// The data cache stores JSON; Prisma rows hold Decimals and Dates. Tag them
// on the way in and rebuild them on the way out, so the page gets exactly
// what Prisma returns.
type Tagged = { $decimal: string } | { $date: string };

export function toCacheJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Prisma.Decimal.isDecimal(value)) return { $decimal: value.toString() } satisfies Tagged;
  if (value instanceof Date) return { $date: value.toISOString() } satisfies Tagged;
  if (Array.isArray(value)) return value.map(toCacheJson);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toCacheJson(v)]));
}

export function fromCacheJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(fromCacheJson);
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$decimal") return new Prisma.Decimal((value as { $decimal: string }).$decimal);
  if (keys.length === 1 && keys[0] === "$date") return new Date((value as { $date: string }).$date);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromCacheJson(v)]));
}

export async function cachedTitlePageData(slug: string): Promise<TitlePageData | null> {
  if (!process.env.NEXT_RUNTIME) return loadTitlePageData(slug);
  const cached = unstable_cache(
    async () => toCacheJson(await loadTitlePageData(slug)),
    ["catalog-public:title-page", slug],
    { tags: [CATALOG_FACETS_TAG, CATALOG_TITLES_TAG], revalidate: 60 },
  );
  return fromCacheJson(await cached()) as TitlePageData | null;
}

