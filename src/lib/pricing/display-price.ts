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
// Browse surfaces never show an exact figure. Before a quote, the only exact
// prices a buyer sees are plan lines they can instant-order (plan-total.ts
// lineDisplay). Spec (and its 2026-09-30 amendment):
// docs/superpowers/specs/2026-06-11-catalog-price-bands-design.md

import {
  indicativeFromRules,
  resolveDefaultMarginPct,
  toRateRules,
} from "@/lib/money";
import type { PricingDefaults } from "@/lib/content-fee";
import { publisherProducesContent } from "@/lib/authorship";
import { isProductPriceShown, type TitleWithVisibility } from "./visibility";
import { priceBand, type Band } from "./bands";
import { articleFee } from "./production-fee";
import { placementLineTotal } from "./line-price";

// Structural types: Prisma rows satisfy these, and tests can pass plain
// objects. Decimal fields are `unknown` and converted at the boundary.
export type DisplayProduct = {
  active: boolean;
  confirmedAt: Date | null;
  type: string;
  basePrice: unknown;
  currency: string;
  // REQUIRED: a Prisma `select` that omits this field made isFlat() treat
  // CPM products as FLAT and band a 500 NOK CPM rate as "< 15k NOK" on
  // the v1 API and CSV export (2026-06-12). Forcing the key means any
  // select that forgets it fails typecheck instead of mispricing.
  pricingModel: string;
  priceRules: { marginPct: unknown; seasonalMultiplier: unknown; minVolume: number }[];
  productionFee?: unknown;
  // Curated deliverables (pricing/inclusions.ts): "production": "PUBLISHER"
  // means the publisher's studio writes the article (no fee of ours).
  inclusions?: unknown;
};

export type DisplayTitle = TitleWithVisibility & {
  productionFeeDefault?: unknown;
  market: { code: string };
};

function isFlat(product: DisplayProduct): boolean {
  return !product.pricingModel || product.pricingModel === "FLAT";
}

function feeSource(product: DisplayProduct, title: DisplayTitle) {
  return {
    type: product.type,
    inclusions: product.inclusions,
    productionFee: product.productionFee,
    title: { productionFeeDefault: title.productionFeeDefault },
  };
}

// The article fee this product's band folds in: the fee a line added from the
// catalog is charged, because that line starts with "We write it" on
// (authorship.ts defaultContentIntent) — unless the publisher's own studio
// writes it, where the line starts PUBLISHER_PRODUCED and no fee is charged.
function bandArticleFee(product: DisplayProduct, title: DisplayTitle, defaults: PricingDefaults): number {
  const source = feeSource(product, title);
  if (publisherProducesContent(source)) return 0;
  return articleFee(source, title.market.code, defaults.feeRules);
}

// All-in customer price of ONE placement as a line added from the catalog is
// priced: the placement by the order's line builder, plus the article fee
// (flat, NOT marked up — our production service, not inventory). The same two
// helpers price the plan line (plan-total.ts) and the order, so the band
// always contains what the plan and the order charge for this product with
// its default "We write it" choice. Only meaningful for FLAT products; rate
// products go through unitRate.
export function customerPrice(
  product: DisplayProduct,
  title: DisplayTitle,
  defaults: PricingDefaults,
): number {
  return (
    placementLineTotal(product, title.market.code, 1, defaults.marginRules) +
    bandArticleFee(product, title, defaults)
  );
}

// Whether a product's band includes a written article — the "incl. article"
// every band label carries. True when the band folds in our article fee, or
// the publisher's own studio writes it (the article is in the offer either
// way). False only when no fee applies and nobody is stated to write it. One
// rule for the catalog row and card, the title page, compare, the
// recommenders and the plan's placement picker.
export function bandIncludesArticle(
  product: DisplayProduct,
  title: DisplayTitle,
  defaults: PricingDefaults,
): boolean {
  if (publisherProducesContent(feeSource(product, title))) return true;
  return bandArticleFee(product, title, defaults) > 0;
}

// What one placement costs the buyer, for BUDGET PLANNING (the recommenders
// fitting a mix into a budget). Never rendered as a figure on a browse
// surface — callers show productBand() instead.
//
// Null for CPM/CPC products: a rate is not a per-placement price, and
// treating a 300 NOK CPM as a 345 NOK "article" put Nettavisen into public
// recommendations at 345 kr (the /recommend bug). Their cost depends on
// volume, which only the quote flow resolves. Null for hidden prices too.
export function plannablePrice(
  product: DisplayProduct,
  title: DisplayTitle,
  defaults: PricingDefaults,
): number | null {
  if (!isFlat(product)) return null;
  if (!isProductPriceShown(product, title)) return null;
  return customerPrice(product, title, defaults);
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
