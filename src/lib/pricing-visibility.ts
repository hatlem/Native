// Buyer-facing price visibility — the single source of truth for
// "should the advertiser see a € figure for this title?". Cascades
// publisher.pricesPublic AND title.pricesPublic, defaulting to true
// for legacy rows. When false, every public surface (catalog,
// recommender, marketing, public API) renders "Request price"
// instead of a number; self-serve FIRM checkout is also blocked
// since the buyer would otherwise see the firm number at checkout.
//
// The desk is unaffected — internal pricing flows through Product /
// PriceRule and is always visible to staff. This module only governs
// what reaches the buyer.

export type TitleWithVisibility = {
  pricesPublic?: boolean | null;
  publisher?: { pricesPublic?: boolean | null } | null;
};

export function arePricesVisible(title: TitleWithVisibility): boolean {
  const titleOn = title.pricesPublic ?? true;
  const publisherOn = title.publisher?.pricesPublic ?? true;
  return titleOn && publisherOn;
}

// Convenience for collections — true only if EVERY title in the
// collection has visible prices. Used to gate self-serve checkout on
// a basket: any hidden line forces the whole basket onto the RFQ path.
export function allPricesVisible(titles: TitleWithVisibility[]): boolean {
  return titles.every(arePricesVisible);
}

// True if AT LEAST ONE title in the collection has hidden prices.
// Mirror of !allPricesVisible but reads better in conditionals like
// `if (anyHiddenPrices(...)) showRfqNotice()`.
export function anyHiddenPrices(titles: TitleWithVisibility[]): boolean {
  return titles.some((t) => !arePricesVisible(t));
}

// Redact pricing fields for the public-API JSON shape. Returns a new
// object with any price-like keys replaced by null, plus an explicit
// `priceVisible: false` flag so consumers know it was a deliberate
// redaction rather than missing data. Keeps the field surface stable
// for clients that depend on it.
export function redactProductPricing<
  T extends {
    basePrice?: unknown;
    currency?: string;
    visibility?: string;
  },
>(product: T, visible: boolean): T & { priceVisible: boolean } {
  if (visible) return { ...product, priceVisible: true };
  return {
    ...product,
    basePrice: null,
    visibility: "INDICATIVE",
    priceVisible: false,
  };
}
