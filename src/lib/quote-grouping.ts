// Multi-currency basket support. A single Plan can span placements
// across several markets (a Norwegian agency buying NO + SE + DE
// titles in one campaign). Each market has its own VAT regime and
// invoicing currency, so we materialize one Quote per market —
// Request.quotes[] is already plural in the schema, this module
// just gives us a clean grouping helper to drive the split.
//
// Grouping key is Title.marketId (NOT product.currency) because the
// Eurozone has multiple markets sharing EUR with different VAT rates:
// DE 19%, AT 20%, IE 23%, FI 25%. Grouping by currency would merge
// them and apply one VAT to all four — wrong.
//
// Pure module: no DB calls. Caller hydrates the product map (with
// title→market relations) and passes it in.

export type QuoteGroupingProduct = {
  id: string;
  title: {
    marketId: string;
    market: {
      code: string;
      currency: string;
      vatRatePct: unknown; // Prisma Decimal or string at runtime
    };
  };
};

export type QuoteGroupingItem = {
  productId: string;
  quantity: number;
};

export type QuoteGroup<TItem extends QuoteGroupingItem = QuoteGroupingItem> = {
  marketId: string;
  marketCode: string;
  currency: string;
  vatPct: number;
  items: TItem[];
};

// Group basket items by the placement's market. Items with a productId
// missing from the product map are dropped — caller is responsible for
// having filtered the basket against active/bookable products first.
// Output is sorted by market code so multi-quote renders are stable
// across page loads.
export function groupItemsByMarket<TItem extends QuoteGroupingItem>(
  items: TItem[],
  productsById: Map<string, QuoteGroupingProduct>,
): QuoteGroup<TItem>[] {
  const groups = new Map<string, QuoteGroup<TItem>>();
  for (const item of items) {
    const product = productsById.get(item.productId);
    if (!product) continue;
    const key = product.title.marketId;
    let group = groups.get(key);
    if (!group) {
      group = {
        marketId: key,
        marketCode: product.title.market.code,
        currency: product.title.market.currency,
        vatPct: Number(product.title.market.vatRatePct),
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) =>
    a.marketCode.localeCompare(b.marketCode),
  );
}
