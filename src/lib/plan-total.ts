import { indicativeFromRules, toRateRules } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import type { ProductWithConfirmation, TitleWithVisibility } from "@/lib/pricing/visibility";

export type ListTotal = { currency: string; amount: number; hasHidden: boolean; itemCount: number };

// The minimal item shape the estimate needs — structural, so both the fully
// hydrated UnsentList/ActiveList items AND lean per-wave selects (the /plan
// programme strip loads only these fields for up to four wave lists) satisfy
// it without casting. basePrice/marginPct stay `unknown` because Prisma hands
// us Decimals and tests hand us numbers; Number() normalises either.
export type EstimableListItem = {
  productId: string | null;
  quantity: number;
  product:
    | (ProductWithConfirmation & {
        currency: string;
        basePrice: unknown;
        priceRules: { marginPct: unknown; seasonalMultiplier: unknown; minVolume: number }[];
        title: TitleWithVisibility;
      })
    | null;
};

// Rough per-currency total for a saved list — same indicative-price logic
// as /plan's line rendering, kept as a separate pure function so summary
// surfaces (the Kampanjer drafts hub) don't have to load /plan's full
// render path just to show "ca. 81 650 kr" on a list card.
//
// itemCount travels alongside the amount so a plan spanning two
// currencies can say "SEK 95,565 for 4 titles + €92 for 1 title" instead
// of two bare figures — buyers reading "SEK X · €Y" side by side kept
// asking whether that meant a choice of currency to pay in, not two
// separate charges that both apply.
export function estimateListTotals(items: EstimableListItem[]): ListTotal[] {
  const byCurrency = new Map<string, ListTotal>();
  for (const item of items) {
    if (!item.productId || !item.product) continue;
    const product = item.product;
    const entry = byCurrency.get(product.currency) ?? {
      currency: product.currency,
      amount: 0,
      hasHidden: false,
      itemCount: 0,
    };
    entry.itemCount += 1;
    if (isProductPriceShown(product, product.title)) {
      const unit = indicativeFromRules(
        Number(product.basePrice),
        toRateRules(product.priceRules),
        item.quantity,
      );
      entry.amount += unit * item.quantity;
    } else {
      entry.hasHidden = true;
    }
    byCurrency.set(product.currency, entry);
  }
  return [...byCurrency.values()];
}
