import { MarketCode, ProductType } from "@prisma/client";

export const MARKET_CODES = Object.values(MarketCode);
export const PRODUCT_TYPES = Object.values(ProductType);
// Catalog format filter highlights the buyable formats — research-only enum
// members (CONTEXTUAL, OTHER) intentionally don't show in the filter.
export const FORMAT_KEYS: ProductType[] = [
  ProductType.NATIVE_ARTICLE,
  ProductType.ADVERTORIAL,
  ProductType.NATIVE_DISPLAY,
  ProductType.PACKAGE,
  ProductType.NATIVE_PLUS,
  ProductType.CONTENT_VIDEO,
];
export const NATIVE_FIT_VALUES = ["High", "Medium", "Low"] as const;
export const B2B_B2C_VALUES = ["B2B", "B2C"] as const;
export const REACH_VALUES = ["National", "Regional", "Local", "Niche"] as const;
export const PAGE_SIZE = 60;

export function asEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
) {
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function parseCatalogParams(
  sp: Record<string, string | string[] | undefined>,
) {
  // `market` is multi-select (CSV). A single value still works — same param
  // shape as `types`. This lets tri-Nordic buyers run one query across NO·SE·DK
  // instead of three.
  const marketsRaw =
    typeof sp.market === "string" ? sp.market : "";
  const markets: MarketCode[] = marketsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is MarketCode =>
      (MARKET_CODES as readonly string[]).includes(s),
    );
  // `types` is the new multi-select param (CSV). Fall back to the legacy
  // single `type` param so older shared links keep working.
  const typesRaw =
    typeof sp.types === "string"
      ? sp.types
      : typeof sp.type === "string"
        ? sp.type
        : "";
  const types: ProductType[] = typesRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ProductType =>
      (PRODUCT_TYPES as readonly string[]).includes(s),
    );
  const verticalsRaw = typeof sp.vertical === "string" ? sp.vertical : "";
  const verticals = verticalsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const regionsRaw = typeof sp.region === "string" ? sp.region : "";
  const regions = regionsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const nativeFit = asEnum(
    typeof sp.nativeFit === "string" ? sp.nativeFit : undefined,
    NATIVE_FIT_VALUES,
  );
  const b2bB2c = asEnum(
    typeof sp.b2bB2c === "string" ? sp.b2bB2c : undefined,
    B2B_B2C_VALUES,
  );
  const reach = asEnum(
    typeof sp.reach === "string" ? sp.reach : undefined,
    REACH_VALUES,
  );
  const onlyPriced =
    typeof sp.onlyPriced === "string" && sp.onlyPriced === "1";
  const compareMode =
    typeof sp.compareMode === "string" && sp.compareMode === "1";
  // Advanced section auto-opens only for the compare picker now — B2B/B2C
  // moved to the main filter row, so it no longer drives this.
  const advancedOpen = compareMode;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const pageRaw = typeof sp.page === "string" ? parseInt(sp.page, 10) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  return {
    markets,
    types,
    verticals,
    regions,
    nativeFit,
    b2bB2c,
    reach,
    onlyPriced,
    compareMode,
    advancedOpen,
    q,
    page,
  };
}
