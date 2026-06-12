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
// Bands apply to FLAT (per-placement) prices only. CPM/CPC rate cards
// render via unitRate() — banding a 345 NOK CPM as if it were an
// article price produced absurd "< 15k" cards (the Adresseavisen bug).
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
  // Optional for back-compat with callers/tests that predate unit
  // handling; missing means FLAT (the schema default).
  pricingModel?: string;
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

function isFlat(product: DisplayProduct): boolean {
  return !product.pricingModel || product.pricingModel === "FLAT";
}

// All-in customer price: marked-up indicative + flat production fee
// (the fee is NOT marked up — it is our cost-recovery, not inventory).
// Only meaningful for FLAT products; rate products go through unitRate.
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
  if (!isFlat(product)) return null;
  if (!isProductPriceShown(product, title)) return null;
  return priceBand(customerPrice(product, title, defaults), product.currency);
}

// Marked-up unit rate for CPM/CPC products, rounded to the nearest 5 so
// the publisher's exact net rate is not recoverable. No production fee
// folded in — the all-in cost of a rate product depends on volume, which
// the quote flow resolves. Null for FLAT or hidden products.
export function unitRate(
  product: DisplayProduct,
  title: DisplayTitle,
  defaults: PricingDefaults,
): { rate: number; unit: string } | null {
  if (isFlat(product)) return null;
  if (!isProductPriceShown(product, title)) return null;
  const indicative = indicativeFromRules(
    Number(product.basePrice),
    toRateRules(product.priceRules),
    1,
    resolveDefaultMarginPct(defaults.marginRules, title.market.code),
  );
  return {
    rate: Math.round(indicative / 5) * 5,
    unit: product.pricingModel as string,
  };
}

// Card-level band. Prefer the NATIVE_ARTICLE product when one is shown
// (it is the category lead and what the buyer came for) — otherwise the
// cheapest shown product. Prevents a cheap display product producing a
// "< 15k" band that reads as bait next to a 35k article. Rate (CPM/CPC)
// products never produce the card band — their numbers aren't comparable
// to per-placement prices.
export function titleBand<P extends DisplayProduct>(
  products: P[],
  title: DisplayTitle,
  defaults: PricingDefaults,
): { band: Band; product: P } | null {
  const shown = products.filter(
    (p) => isFlat(p) && isProductPriceShown(p, title),
  );
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

// Card-level rate fallback for titles whose only confirmed pricing is
// CPM/CPC (e.g. Adresseavisen). Without this the grid says "Contact for
// price" while the detail page shows "≈ 395 NOK CPM" — a priced title
// shouldn't look unpriced one click earlier. Cheapest shown rate wins.
export function titleRate<P extends DisplayProduct>(
  products: P[],
  title: DisplayTitle,
  defaults: PricingDefaults,
): { rate: number; unit: string; product: P } | null {
  const rated = products
    .map((p) => {
      const r = unitRate(p, title, defaults);
      return r ? { ...r, product: p } : null;
    })
    .filter((r): r is { rate: number; unit: string; product: P } => r !== null);
  if (rated.length === 0) return null;
  return rated.sort((a, b) => a.rate - b.rate)[0];
}
