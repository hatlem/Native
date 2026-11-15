// Cached lookups behind the public catalog's filter rail. /catalog is the
// most-visited page and is rendered per request; these three queries (market
// currencies, the distinct verticals, the distinct regions) scan the Title
// table on every view although they change only when the desk curates a
// title or a backfill runs. They are cached across requests and refreshed
//   - on a 5-minute timer, and
//   - immediately when a title's catalog visibility changes
//     (invalidateCatalogFacets, called from the desk title actions).
// Scripts and the MCP tools write outside the Next server, so the timer is
// what picks their changes up.
import { revalidateTag, unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadVerticalOptions } from "@/lib/catalog-taxonomy";

export const CATALOG_FACETS_TAG = "catalog-facets";
const REVALIDATE_SECONDS = 300;
const opts = { tags: [CATALOG_FACETS_TAG], revalidate: REVALIDATE_SECONDS };

// Currency per market code, e.g. { NO: "NOK", SE: "SEK" }.
export const cachedMarketCurrencies = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const rows = await prisma.market.findMany({ select: { code: true, currency: true } });
    return Object.fromEntries(rows.map((m) => [m.code, m.currency]));
  },
  ["catalog-facets:market-currencies"],
  opts,
);

export const cachedVerticalOptions = unstable_cache(
  async (): Promise<string[]> => loadVerticalOptions(),
  ["catalog-facets:verticals"],
  opts,
);

// Distinct regions present from the geo backfill, each with one country,
// picked deterministically (ordered by countryCode).
export const cachedRegionRows = unstable_cache(
  async (): Promise<Array<{ region: string; countryCode: string }>> => {
    const rows = await prisma.title.findMany({
      where: { region: { not: null } },
      select: { region: true, countryCode: true },
      distinct: ["region"],
      orderBy: [{ region: "asc" }, { countryCode: "asc" }],
    });
    return rows
      .filter((r) => r.region && r.region.trim().length > 0)
      .map((r) => ({ region: r.region!, countryCode: r.countryCode as string }));
  },
  ["catalog-facets:regions"],
  opts,
);

// Call after a mutation that changes which titles the catalog shows.
export function invalidateCatalogFacets(): void {
  try {
    // "max": serve the stale list while the fresh one is computed.
    revalidateTag(CATALOG_FACETS_TAG, "max");
  } catch {
    // Outside a Next request scope (scripts, tests) there is no cache.
  }
}
