// Content-production fee — what NativeSpin charges for writing a placement's
// article. Cascade — FIRST SET value wins (null/undefined = unset; an explicit
// 0 is a valid value meaning "publisher includes production"):
//   1. Product.productionFee        (this offer)
//   2. Title.productionFeeDefault   (this publication)
//   3. ContentFeeRule.greenfieldFee (desk price list, /desk/content-fees;
//      most-specific active match via pickContentFeeRule)
//   4. 0 — no rule configured; the band still renders.
// The fee is added AFTER the margin (flat, not marked up).
//
// ONE figure everywhere: articleFee() is what the catalog band folds in
// (display-price.ts customerPrice), what a "We write it" plan line adds
// (plan-total.ts linePrice) and what the order and the desk quote bill
// (contentFeeLinesFor → computeContentFeeLines). They used to diverge — the
// band read the offer/publication fee, the plan and order only the desk rule —
// so a band could promise a price the order never charged.

import {
  computeContentFeeLines,
  pickContentFeeRule,
  type ContentFeeRuleSpec,
  type QuoteLineComputation,
} from "../money";
import { nativeSpinProduces, publisherProducesContent, type AuthorshipMode } from "../authorship";

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

// Structural: Prisma rows (Decimal fees) and plain test objects both fit.
export type FeeProduct = {
  type: string;
  productionFee?: unknown;
  // Curated deliverables (pricing/inclusions.ts). REQUIRED, not optional:
  // "production": "PUBLISHER" means the publisher's studio writes the article,
  // so no fee of ours applies — a select that forgot it charged our fee on an
  // article the publisher already produces (BUG-final-prod-1). Forcing the key
  // makes such a select fail typecheck instead of overcharging.
  inclusions: unknown;
  title?: { productionFeeDefault?: unknown } | null;
};

// Layers 1–2 of the cascade: the offer's, else the publication's own fee.
// Null = inherit the desk rule.
export function offerProductionFee(product: FeeProduct): number | null {
  if (product.productionFee != null) return Number(product.productionFee);
  const titleFee = product.title?.productionFeeDefault;
  return titleFee != null ? Number(titleFee) : null;
}

// The article fee for one placement, by the order's own line builder: 0 when
// no fee applies — and always 0 on a publisher-produced placement: the
// publisher's studio writes that article, so there is nothing for us to write
// or bill, whatever the desk rule for the format says.
export function articleFee(product: FeeProduct, marketCode: string, rules: ContentFeeRuleSpec[]): number {
  if (publisherProducesContent(product)) return 0;
  return computeContentFeeLines(
    [{ name: "", productType: product.type, fee: offerProductionFee(product) }],
    rules,
    marketCode,
  ).reduce((sum, l) => sum + l.lineTotal, 0);
}

// CONTENT_FEE lines for one market group of an order or quote: the items
// NativeSpin writes (authorshipMode when present, else the legacy withContent
// toggle — the two are kept in sync), each priced by the cascade above. A
// publisher-produced placement never gets one, even if a stale row still asks
// for "We write it": the fee would bill an article the publisher writes.
export function contentFeeLinesFor(
  groupItems: { productId: string; withContent?: boolean; authorshipMode?: AuthorshipMode }[],
  byId: Map<string, FeeProduct & { name: string }>,
  marketCode: string,
  rules: ContentFeeRuleSpec[],
): QuoteLineComputation[] {
  const feeItems = groupItems
    .filter((i) => (i.authorshipMode ? nativeSpinProduces(i.authorshipMode) : !!i.withContent))
    .map((i) => byId.get(i.productId))
    .filter((p): p is FeeProduct & { name: string } => !!p && !publisherProducesContent(p))
    .map((p) => ({ name: p.name, productType: p.type, fee: offerProductionFee(p) }));
  return computeContentFeeLines(feeItems, rules, marketCode);
}
