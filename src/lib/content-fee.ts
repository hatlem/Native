// DB adapter for content-fee pricing. The pure math lives in money.ts
// (pickContentFeeRule / computeContentFeeLines); this loads the desk's
// active rules and turns a market group's withContent items into
// CONTENT_FEE quote lines. Kept out of money.ts so the test suite can
// import the pure helpers without a DB.

import { prisma } from "@/lib/prisma";
import {
  computeContentFeeLines,
  type ContentFeeRuleSpec,
  type QuoteLineComputation,
} from "@/lib/money";
import { nativeSpinProduces, type AuthorshipMode } from "@/lib/authorship";

export async function loadContentFeeRules(): Promise<ContentFeeRuleSpec[]> {
  const rules = await prisma.contentFeeRule.findMany({
    where: { active: true },
  });
  return rules.map((r) => ({
    marketCode: r.marketCode,
    productType: r.productType,
    currency: r.currency,
    greenfieldFee: Number(r.greenfieldFee),
    adaptationFee: r.adaptationFee != null ? Number(r.adaptationFee) : null,
    active: r.active,
  }));
}

type FeeProduct = { name: string; type: string };

// Build CONTENT_FEE lines for one market group: the items the buyer
// flagged withContent, priced from the rules at the group's market.
export function contentFeeLinesForGroup(
  groupItems: { productId: string; withContent?: boolean; authorshipMode?: AuthorshipMode }[],
  byId: Map<string, FeeProduct>,
  marketCode: string,
  rules: ContentFeeRuleSpec[],
): QuoteLineComputation[] {
  const feeItems = groupItems
    // Derive billing from authorship when the mode is present; fall back to
    // the legacy withContent toggle (the two are kept in sync — withContent
    // is just the v1 input authorshipMode is projected from).
    .filter((i) =>
      i.authorshipMode ? nativeSpinProduces(i.authorshipMode) : !!i.withContent,
    )
    .map((i) => byId.get(i.productId))
    .filter((p): p is FeeProduct => !!p)
    .map((p) => ({ name: p.name, productType: p.type }));
  return computeContentFeeLines(feeItems, rules, marketCode);
}
