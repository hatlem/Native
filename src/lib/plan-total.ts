import { indicativeFromRules, toRateRules } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import type { UnsentList } from "@/lib/lists";

export type ListTotal = { currency: string; amount: number; hasHidden: boolean };

// Rough per-currency total for a saved list — same indicative-price logic
// as /plan's line rendering, kept as a separate pure function so summary
// surfaces (the Kampanjer drafts hub) don't have to load /plan's full
// render path just to show "ca. 81 650 kr" on a list card.
export function estimateListTotals(items: UnsentList["items"]): ListTotal[] {
  const byCurrency = new Map<string, ListTotal>();
  for (const item of items) {
    if (!item.productId || !item.product) continue;
    const product = item.product;
    const entry = byCurrency.get(product.currency) ?? {
      currency: product.currency,
      amount: 0,
      hasHidden: false,
    };
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
