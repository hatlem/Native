// Content-production fee for the all-in catalog display price.
// Cascade — FIRST SET value wins (null/undefined = unset; an explicit 0
// is a valid value meaning "publisher includes production"):
//   1. Product.productionFee        (this offer)
//   2. Title.productionFeeDefault   (this publication)
//   3. ContentFeeRule.greenfieldFee (desk price list, /desk/content-fees;
//      most-specific active match via pickContentFeeRule)
//   4. 0 — no rule configured; the band still renders.
// The fee is added AFTER the margin (flat, not marked up) — see
// customerPrice() in display-price.ts.

import { pickContentFeeRule, type ContentFeeRuleSpec } from "../money";

export function resolveProductionFee(args: {
  productFee: number | null | undefined;
  titleFee: number | null | undefined;
  productType: string;
  marketCode: string;
  rules: ContentFeeRuleSpec[];
}): number {
  if (args.productFee != null) return args.productFee;
  if (args.titleFee != null) return args.titleFee;
  const rule = pickContentFeeRule(args.rules, args.productType, args.marketCode);
  return rule ? rule.greenfieldFee : 0;
}
