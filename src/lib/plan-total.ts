import {
  computeContentFeeLines,
  computeQuoteLines,
  quoteTotals,
  resolveDefaultMarginPct,
  toRateRules,
  type ContentFeeRuleSpec,
  type MarginRuleSpec,
} from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import type { ProductWithConfirmation, TitleWithVisibility } from "@/lib/pricing/visibility";

// The desk-owned pricing inputs every estimate needs: default margins (for a
// product with no rate card) and content-fee rules. Structurally the same as
// content-fee.ts's PricingDefaults — declared here so this module stays
// DB-free and the unit tests can import it without Prisma.
export type PlanPricing = {
  feeRules: ContentFeeRuleSpec[];
  marginRules: MarginRuleSpec[];
};

export type ListTotal = {
  currency: string;
  // Excluding VAT: placements plus content fees, priced lines only. This is
  // the subtotal the order carries.
  amount: number;
  // The content-production part of `amount` ("We write it" lines).
  contentFees: number;
  // VAT on `amount`, per placement market (the EUR markets share a currency
  // but not a rate), and `amount + vat` — what the buyer actually pays.
  vat: number;
  totalInclVat: number;
  hasVisible: boolean;
  hasHidden: boolean;
  itemCount: number;
};

// The minimal item shape the estimate needs — structural, so both the fully
// hydrated UnsentList/ActiveList items AND lean per-wave selects (the /plan
// programme strip loads only these fields for up to four wave lists) satisfy
// it without casting. basePrice/marginPct/vatRatePct stay `unknown` because
// Prisma hands us Decimals and tests hand us numbers; Number() normalises
// either.
export type EstimableListItem = {
  productId: string | null;
  quantity: number;
  // "We write it": adds the content fee the order will charge.
  withContent: boolean;
  // Recommended alternatives are shown beside a plan but never totalled.
  isAlternative?: boolean;
  product:
    | (ProductWithConfirmation & {
        type: string;
        currency: string;
        basePrice: unknown;
        priceRules: { marginPct: unknown; seasonalMultiplier: unknown; minVolume: number }[];
        title: TitleWithVisibility & { market: { code: string; vatRatePct: unknown } };
      })
    | null;
};

type PricedProduct = NonNullable<EstimableListItem["product"]>;

// A placement's line total, computed by the same engine the order uses
// (computeQuoteLines with the market's default margin, rounded per line), so
// the figure on /plan is the figure on the order — not a lookalike that
// drifts when a market's margin rule differs from the global default.
export function placementLineTotal(
  product: Pick<PricedProduct, "basePrice" | "priceRules"> & { title: { market: { code: string } } },
  quantity: number,
  marginRules: MarginRuleSpec[],
): number {
  const [line] = computeQuoteLines(
    [{ productId: "", name: "", quantity, basePrice: Number(product.basePrice), rules: toRateRules(product.priceRules) }],
    resolveDefaultMarginPct(marginRules, product.title.market.code),
  );
  return line.lineTotal;
}

// The content fee the order adds for a "We write it" placement: one fee per
// line whatever the quantity, from the most specific active rule. No rule →
// no fee, exactly as the order behaves (computeContentFeeLines skips it).
export function contentFeeFor(
  productType: string,
  marketCode: string,
  feeRules: ContentFeeRuleSpec[],
): number {
  return computeContentFeeLines([{ name: "", productType }], feeRules, marketCode).reduce(
    (sum, l) => sum + l.lineTotal,
    0,
  );
}

// Per-currency total for a saved list: what the buyer commits to if the list
// is ordered as it stands. Shared by /plan's summary, the Kampanjer drafts hub
// and the catalog shortlist, so no surface shows a figure the order won't.
//
// itemCount travels alongside the amount so a plan spanning two
// currencies can say "SEK 95,565 for 4 titles + €92 for 1 title" instead
// of two bare figures — buyers reading "SEK X · €Y" side by side kept
// asking whether that meant a choice of currency to pay in, not two
// separate charges that both apply.
//
// A hidden-price line registers its currency (hasHidden) but adds nothing —
// not even its content fee, so the total never mixes a known fee with an
// unknown placement it belongs to.
export function estimateListTotals(items: EstimableListItem[], pricing: PlanPricing): ListTotal[] {
  type Acc = ListTotal & { byMarket: Map<string, { subtotal: number; vatPct: number }> };
  const byCurrency = new Map<string, Acc>();
  for (const item of items) {
    if (item.isAlternative) continue;
    if (!item.productId || !item.product) continue;
    const product = item.product;
    const entry: Acc = byCurrency.get(product.currency) ?? {
      currency: product.currency,
      amount: 0,
      contentFees: 0,
      vat: 0,
      totalInclVat: 0,
      hasVisible: false,
      hasHidden: false,
      itemCount: 0,
      byMarket: new Map(),
    };
    entry.itemCount += 1;
    if (isProductPriceShown(product, product.title)) {
      const market = product.title.market;
      const placement = placementLineTotal(product, item.quantity, pricing.marginRules);
      const fee = item.withContent ? contentFeeFor(product.type, market.code, pricing.feeRules) : 0;
      entry.amount += placement + fee;
      entry.contentFees += fee;
      entry.hasVisible = true;
      const m = entry.byMarket.get(market.code) ?? { subtotal: 0, vatPct: Number(market.vatRatePct) };
      m.subtotal += placement + fee;
      entry.byMarket.set(market.code, m);
    } else {
      entry.hasHidden = true;
    }
    byCurrency.set(product.currency, entry);
  }
  return [...byCurrency.values()].map(({ byMarket, ...total }) => {
    // One order (and one VAT rounding) per placement market — mirror it.
    const totalInclVat = [...byMarket.values()].reduce(
      (sum, m) => sum + quoteTotals([{ lineTotal: m.subtotal }], m.vatPct).total,
      0,
    );
    return { ...total, totalInclVat, vat: totalInclVat - total.amount };
  });
}

export type PlanBarSummary = {
  // Product ids on the plan (alternatives excluded): drives each catalog row's
  // "On plan" state.
  productIds: string[];
  // Lines on the plan, placements and not-yet-placed titles alike (the count
  // /plan's header shows).
  count: number;
  totals: Array<{ currency: string; amount: number; itemCount: number }>;
};

// The catalog's sticky plan bar: the same totals as /plan (estimateListTotals,
// the order's pricing: customer price and content fees), never a figure
// computed in the browser from a product's net base price.
export function planBarSummary(
  items: Array<EstimableListItem & { titleId: string | null }>,
  pricing: PlanPricing,
): PlanBarSummary {
  const committed = items.filter((i) => !i.isAlternative);
  return {
    productIds: committed.map((i) => i.productId).filter((id): id is string => id !== null),
    count: committed.filter((i) => i.productId || i.titleId).length,
    totals: estimateListTotals(committed, pricing)
      .filter((r) => r.hasVisible)
      .map((r) => ({ currency: r.currency, amount: r.amount, itemCount: r.itemCount })),
  };
}
