// The one place that turns a catalog product into the buyer-facing
// price band. Every browse surface (grid card, title detail, compare,
// JSON API, CSV export, JSON-LD) goes through these helpers so band
// selection can never drift between surfaces.
//
// Margin and fee defaults arrive together as one PricingDefaults bundle
// (loadPricingDefaults): products without a PriceRule fall back to the
// admin MarginRule for the title's market (then the 15% constant), so
// bands and desk quotes share the same default-margin source.
//
// Exact figures live ONLY in the quote flow. Spec:
// docs/superpowers/specs/2026-06-11-catalog-price-bands-design.md

import {
  indicativeFromRules,
  resolveDefaultMarginPct,
  toRateRules,
} from "@/lib/money";
import type { PricingDefaults } from "@/lib/content-fee";
import { isProductPriceShown, type TitleWithVisibility } from "./visibility";
import { priceBand, type Band } from "./bands";
import { resolveProductionFee } from "./production-fee";

// Structural types: Prisma rows satisfy these, and tests can pass plain
// objects. Decimal fields are `unknown` and converted at the boundary.
export type DisplayProduct = {
  active: boolean;
  confirmedAt: Date | null;
  type: string;
  basePrice: unknown;
  currency: string;
  priceRules: { marginPct: unknown; seasonalMultiplier: unknown; minVolume: number }[];
  productionFee?: unknown;
};

export type DisplayTitle = TitleWithVisibility & {
  productionFeeDefault?: unknown;
  market: { code: string };
};

function toNumberOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}

// All-in customer price: marked-up indicative + flat production fee
// (the fee is NOT marked up — it is our cost-recovery, not inventory).
export function customerPrice(
  product: DisplayProduct,
  title: DisplayTitle,
  defaults: PricingDefaults,
): number {
  const indicative = indicativeFromRules(
    Number(product.basePrice),
    toRateRules(product.priceRules),
    1,
    resolveDefaultMarginPct(defaults.marginRules, title.market.code),
  );
  const fee = resolveProductionFee({
    productFee: toNumberOrNull(product.productionFee),
    titleFee: toNumberOrNull(title.productionFeeDefault),
    productType: product.type,
    marketCode: title.market.code,
    rules: defaults.feeRules,
  });
  return Math.round(indicative) + fee;
}

export function productBand(
  product: DisplayProduct,
  title: DisplayTitle,
  defaults: PricingDefaults,
): Band | null {
  if (!isProductPriceShown(product, title)) return null;
  return priceBand(customerPrice(product, title, defaults), product.currency);
}

// Card-level band. Prefer the NATIVE_ARTICLE product when one is shown
// (it is the category lead and what the buyer came for) — otherwise the
// cheapest shown product. Prevents a cheap display product producing a
// "< 15k" band that reads as bait next to a 35k article.
export function titleBand<P extends DisplayProduct>(
  products: P[],
  title: DisplayTitle,
  defaults: PricingDefaults,
): { band: Band; product: P } | null {
  const shown = products.filter((p) => isProductPriceShown(p, title));
  if (shown.length === 0) return null;
  const pick =
    shown.find((p) => p.type === "NATIVE_ARTICLE") ??
    [...shown].sort(
      (a, b) =>
        customerPrice(a, title, defaults) - customerPrice(b, title, defaults),
    )[0];
  return {
    band: priceBand(customerPrice(pick, title, defaults), pick.currency),
    product: pick,
  };
}
