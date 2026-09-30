// The placement half of every customer price, by the order's own line builder
// (computeQuoteLines with the market's default margin, rounded per line). The
// catalog band (display-price.ts customerPrice), the plan line
// (plan-total.ts linePrice) and the order (commerce/firm-order.ts) all price a
// placement through this, and the article through production-fee.ts
// articleFee — so the band a buyer sees always contains the figure the plan
// and the order charge for the same product and "We write it" choice.

import {
  computeQuoteLines,
  resolveDefaultMarginPct,
  toRateRules,
  type MarginRuleSpec,
} from "../money";

export type PlacementPriced = {
  basePrice: unknown;
  priceRules: { marginPct: unknown; seasonalMultiplier: unknown; minVolume: number }[];
};

export function placementLineTotal(
  product: PlacementPriced,
  marketCode: string,
  quantity: number,
  marginRules: MarginRuleSpec[],
): number {
  const [line] = computeQuoteLines(
    [{ productId: "", name: "", quantity, basePrice: Number(product.basePrice), rules: toRateRules(product.priceRules) }],
    resolveDefaultMarginPct(marginRules, marketCode),
  );
  return line.lineTotal;
}
