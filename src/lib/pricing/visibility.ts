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

export function redactProductPricing<
  T extends {
    basePrice?: unknown;
    currency?: string;
    visibility?: string;
    active?: boolean;
    confirmedAt?: Date | null;
  },
>(product: T, title: TitleWithVisibility): T & { priceVisible: boolean } {
  const shown = isProductPriceShown(
    { active: product.active ?? true, confirmedAt: product.confirmedAt ?? null },
    title,
  );
  if (shown) return { ...product, priceVisible: true };
  return {
    ...product,
    basePrice: null,
    visibility: "INDICATIVE",
    priceVisible: false,
  };
}
