// Buyer-facing price visibility — single source of truth for "should
// the advertiser see a € figure for this product?". Three gates, ANDed:
//   1. Product is active
//   2. Product has been confirmedAt by sales (not just blueprint-estimated)
//   3. Publisher AND title both have pricesPublic = true
//
// Replaces the older src/lib/pricing-visibility.ts which only covered
// gate 3. The old module re-exports from here for back-compat.

export type TitleWithVisibility = {
  pricesPublic?: boolean | null;
  publisher?: { pricesPublic?: boolean | null } | null;
};

export function arePricesVisible(title: TitleWithVisibility): boolean {
  const titleOn = title.pricesPublic ?? true;
  const publisherOn = title.publisher?.pricesPublic ?? true;
  return titleOn && publisherOn;
}

export function allPricesVisible(titles: TitleWithVisibility[]): boolean {
  return titles.every(arePricesVisible);
}

export function anyHiddenPrices(titles: TitleWithVisibility[]): boolean {
  return titles.some((t) => !arePricesVisible(t));
}

export type ProductWithConfirmation = {
  active: boolean;
  confirmedAt: Date | null;
};

export function isProductPriceShown(
  product: ProductWithConfirmation,
  title: TitleWithVisibility,
): boolean {
  if (!product.active) return false;
  if (product.confirmedAt === null) return false;
  return arePricesVisible(title);
}

// Instant-orderable = the buyer can order this line self-serve, with no desk
// quote: a FIRM price that is also shown (the three gates above). The one rule
// behind the /plan checkout's instant path, the public order API, and "exact
// figure vs band" on every plan surface (lib/plan-total.ts lineDisplay): the
// only prices a buyer sees exactly before a quote are the ones they can order
// at that price right now.
export function isInstantOrderable(
  product: ProductWithConfirmation & { visibility: string },
  title: TitleWithVisibility,
): boolean {
  return product.visibility === "FIRM" && isProductPriceShown(product, title);
}

