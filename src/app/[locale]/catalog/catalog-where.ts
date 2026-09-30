// The catalog's title filter as ONE function, shared by the catalog page and
// its CSV export (api/export/catalog.csv). The export used to build its own
// `{ active: true, market }` where: it ignored the visibility guard (research
// rows are visible but not `active`, so "974 titles in Norway" exported 3
// rows) and every filter but the market. Both now read the same parsed
// params and the same where, so "download what I see" is exactly that.

import type { Prisma } from "@prisma/client";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";
import type { CatalogSearch } from "@/lib/catalog-search";
import type { CatalogParams } from "./filters";

// "Priced titles only" = a buyer can actually see a figure. Mirrors
// isProductPriceShown (src/lib/pricing/visibility.ts): an active,
// sales-confirmed product AND both title + publisher prices public.
const ONLY_PRICED_CONDITIONS: Prisma.TitleWhereInput[] = [
  { products: { some: { active: true, confirmedAt: { not: null } } } },
  { pricesPublic: true },
  { publisher: { is: { pricesPublic: true } } },
];

// Semantic-deliverable filters read curated Product.inclusions (Json).
// Prisma JSON `path` filters on Postgres only match when the key exists
// and the value compares.
function semanticConditions(f: CatalogParams): Prisma.TitleWhereInput[] {
  const out: Prisma.TitleWhereInput[] = [];
  if (f.producedForYou) {
    // Publisher's editorial desk writes the content for the advertiser.
    out.push({
      products: { some: { active: true, inclusions: { path: ["production"], equals: "PUBLISHER" } } },
    });
  }
  if (f.guaranteedReach) {
    // Any committed reach number counts. `gt: 0` doubles as a key-existence
    // check: a missing path never satisfies a numeric comparison.
    out.push({
      products: {
        some: {
          active: true,
          OR: [
            { inclusions: { path: ["viewsPerWeek"], gt: 0 } },
            { inclusions: { path: ["viewsPerMonth"], gt: 0 } },
            { inclusions: { path: ["viewsTotal"], gt: 0 } },
            { inclusions: { path: ["readsTotal"], gt: 0 } },
          ],
        },
      },
    });
  }
  if (f.newsletterIncluded) {
    out.push({ products: { some: { active: true, inclusions: { path: ["newsletter"], equals: true } } } });
  }
  if (f.videoIncluded) {
    out.push({ products: { some: { active: true, inclusions: { path: ["video"], equals: true } } } });
  }
  return out;
}

/** The where for the catalog's result set. `includeOnlyPriced: false` builds
 *  the exact same where minus the "priced only" condition, for the rail's
 *  "N more titles without published pricing" note. */
export function buildCatalogWhere(
  f: CatalogParams,
  search: CatalogSearch | null,
  { includeOnlyPriced = true }: { includeOnlyPriced?: boolean } = {},
): Prisma.TitleWhereInput {
  const { markets, types, verticals, regions, publisher, nativeFit, b2bB2c, reach } = f;
  return {
    ...(markets.length
      ? markets.length === 1
        ? { market: { code: markets[0] } }
        : { market: { code: { in: markets } } }
      : {}),
    ...(types.length ? { products: { some: { type: { in: types }, active: true } } } : {}),
    ...(verticals.length ? { vertical: { in: verticals } } : {}),
    ...(regions.length ? { region: { in: regions } } : {}),
    ...(publisher ? { publisherId: publisher } : {}),
    ...(nativeFit ? { nativeFit } : {}),
    ...(b2bB2c ? { b2bB2c } : {}),
    ...(reach ? { reach } : {}),
    // AND-composed rather than spread: catalogVisibleTitleWhere and the
    // search fallback (buildIlikeFallbackWhere) can each independently
    // produce a top-level `OR` key. Spreading them into the same object
    // literal would let the later one silently clobber the earlier one
    // (object spread: last key wins) — dropping the visibility guard
    // whenever a search falls through to the ILIKE fallback. Combining
    // them as separate AND members keeps both `OR`s intact and composes
    // correctly with the type filter's own products.some above.
    AND: [
      // Show commerce-active titles AND unverified research-catalog rows;
      // hide titles the desk has verified as not offering native, and
      // never surface titles marked discontinued (nedlagt/duplikat).
      // Shared with favorites.ts/list-actions.ts so the guards can't
      // drift apart.
      catalogVisibleTitleWhere,
      // The tiered search clause: a non-empty FTS hit list wins outright;
      // an empty one falls through to the synonym-aware ILIKE fallback
      // instead of pinning `id IN ()`.
      search?.where ?? {},
      ...(includeOnlyPriced && f.onlyPriced ? ONLY_PRICED_CONDITIONS : []),
      ...semanticConditions(f),
    ],
  };
}

/** The non-personalized catalog order: commerce-active titles first, then
 *  the buyer's sort. "reach" ranks by digital reach, monthly (print/legacy)
 *  reach as fallback; nulls last on both (Postgres defaults DESC to NULLS
 *  FIRST). Unset ("relevance") tiebreaks by name. */
export function catalogOrderBy(sort: CatalogParams["sort"]): Prisma.TitleOrderByWithRelationInput[] {
  if (sort === "reach") {
    return [
      { active: "desc" },
      { digitalReach: { sort: "desc", nulls: "last" } },
      { monthlyReach: { sort: "desc", nulls: "last" } },
      { name: "asc" },
    ];
  }
  if (sort === "newest") return [{ active: "desc" }, { updatedAt: "desc" }];
  return [{ active: "desc" }, { name: "asc" }];
}
