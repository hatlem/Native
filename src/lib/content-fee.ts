// DB adapter for content-fee pricing. The pure math lives in money.ts
// (pickContentFeeRule / computeContentFeeLines) and pricing/production-fee.ts
// (the fee cascade); this loads the desk's active rules and turns a market
// group's withContent items into CONTENT_FEE quote lines. Kept out of
// money.ts so the test suite can import the pure helpers without a DB.

import { prisma } from "@/lib/prisma";
import type { ContentFeeRuleSpec, MarginRuleSpec, QuoteLineComputation } from "@/lib/money";
import type { AuthorshipMode } from "@/lib/authorship";
import { contentFeeLinesFor, type FeeProduct } from "@/lib/pricing/production-fee";
import type { ExtraWorkRateSpec } from "@/lib/pricing/extra-work";

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

export type PricingDefaults = {
  feeRules: ContentFeeRuleSpec[];
  marginRules: MarginRuleSpec[];
};

// One bundle for every surface that renders a price band — fee rules and
// margin defaults must come from the same load so bands and quotes agree.
export async function loadPricingDefaults(): Promise<PricingDefaults> {
  const [feeRules, marginRows] = await Promise.all([
    loadContentFeeRules(),
    prisma.marginRule.findMany({ where: { active: true } }),
  ]);
  return {
    feeRules,
    marginRules: marginRows.map((r) => ({
      marketCode: r.marketCode,
      marginPct: Number(r.marginPct),
      active: r.active,
    })),
  };
}

// Build CONTENT_FEE lines for one market group: the items NativeSpin writes,
// each priced by the production-fee cascade (offer → publication → desk rule)
// at the group's market — the same fee the catalog band and the plan line
// show (lib/pricing/production-fee.ts). Products hydrated with their
// productionFee / title.productionFeeDefault get those layers; any other shape
// falls back to the desk rule.
export function contentFeeLinesForGroup(
  groupItems: { productId: string; withContent?: boolean; authorshipMode?: AuthorshipMode }[],
  byId: Map<string, FeeProduct & { name: string }>,
  marketCode: string,
  rules: ContentFeeRuleSpec[],
): QuoteLineComputation[] {
  return contentFeeLinesFor(groupItems, byId, marketCode, rules);
}

// The hourly rate for extra work, per billing currency (ExtraWorkRate). One
// small table, read wherever the article scope is shown or hours are billed.
export async function loadExtraWorkRates(): Promise<ExtraWorkRateSpec[]> {
  const rows = await prisma.extraWorkRate.findMany({ orderBy: { currency: "asc" } });
  return rows.map((r) => ({ currency: r.currency, hourlyRate: Number(r.hourlyRate) }));
}
