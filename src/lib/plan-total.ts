import { quoteTotals, type ContentFeeRuleSpec, type MarginRuleSpec } from "@/lib/money";
import { articleFee, type FeeProduct } from "@/lib/pricing/production-fee";
import { placementLineTotal as placementAt } from "@/lib/pricing/line-price";
import {
  isInstantOrderable,
  isProductPriceShown,
  type ProductWithConfirmation,
  type TitleWithVisibility,
} from "@/lib/pricing/visibility";
import { addRanges, bandRange, priceBand, type Band, type BandRange } from "@/lib/pricing/bands";
import { unitRate } from "@/lib/pricing/display-price";

// The desk-owned pricing inputs every estimate needs: default margins (for a
// product with no rate card) and content-fee rules. Structurally the same as
// content-fee.ts's PricingDefaults — declared here so this module stays
// DB-free and the unit tests can import it without Prisma.
export type PlanPricing = {
  feeRules: ContentFeeRuleSpec[];
  marginRules: MarginRuleSpec[];
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
        // FIRM = orderable at this price without a quote. REQUIRED (not
        // optional) so a lean select that forgets it fails typecheck instead
        // of silently banding every firm line.
        visibility: string;
        // FLAT vs CPM/CPC — a rate product is shown as its rate, never banded
        // as if it were a placement price (display-price.ts). Required for the
        // same reason.
        pricingModel: string;
        // The offer's own article fee, then the publication's (production-fee
        // cascade). Required for the same reason: a select that dropped them
        // priced "We write it" from the desk rule while the catalog band used
        // the offer's fee — the band and the plan disagreed (BUG-r2-2).
        productionFee: unknown;
        // Required for the same reason: "production": "PUBLISHER" means the
        // publisher writes the article and no fee of ours is added.
        inclusions: unknown;
        priceRules: { marginPct: unknown; seasonalMultiplier: unknown; minVolume: number }[];
        title: TitleWithVisibility & {
          productionFeeDefault: unknown;
          market: { code: string; vatRatePct: unknown };
        };
      })
    | null;
};

type PricedProduct = NonNullable<EstimableListItem["product"]>;

// A placement's line total, computed by the same engine the order uses
// (computeQuoteLines with the market's default margin, rounded per line), so
// the figure on /plan is the figure on the order — not a lookalike that
// drifts when a market's margin rule differs from the global default. The
// catalog band is built from the same function (pricing/line-price.ts).
export function placementLineTotal(
  product: Pick<PricedProduct, "basePrice" | "priceRules"> & { title: { market: { code: string } } },
  quantity: number,
  marginRules: MarginRuleSpec[],
): number {
  return placementAt(product, product.title.market.code, quantity, marginRules);
}

// The content fee the order adds for a "We write it" placement: one fee per
// line whatever the quantity, by the production-fee cascade (the offer's own
// fee, else the publication's, else the most specific desk rule) — the same
// fee the catalog band folds in (pricing/production-fee.ts articleFee). No
// fee → none, exactly as the order behaves (computeContentFeeLines skips it).
export function contentFeeFor(
  product: FeeProduct,
  marketCode: string,
  feeRules: ContentFeeRuleSpec[],
): number {
  return articleFee(product, marketCode, feeRules);
}

// How many lines the plan shows: priced placements AND unresolved title
// placeholders — both are things the buyer asked for — but never the
// recommended alternatives beside it. The catalog's plan bar used to count
// product ids only and said "3 titles" for a 6-line plan.
export function planLineCount(items: { isAlternative?: boolean }[]): number {
  return items.filter((i) => !i.isAlternative).length;
}

// The distinct titles behind those lines — a placement's title or a
// placeholder's own. Three formats of one title are one title: the bar read
// "3 titles" for Aftenposten ×3 when it counted lines as titles.
export function planTitleIds(
  items: { isAlternative?: boolean; titleId?: string | null; product?: { titleId: string } | null }[],
): string[] {
  const ids = new Set<string>();
  for (const i of items) {
    if (i.isAlternative) continue;
    const id = i.product?.titleId ?? i.titleId;
    if (id) ids.add(id);
  }
  return [...ids];
}

// One priced line, split the way the order charges it: the placement
// (per-line rounded, market default margin) plus — for "We write it" — one
// content fee. Null when the line has no concrete product or its price is not
// shown.
//
// This is the RAW estimate. It is only ever rendered as a figure for an
// instant-orderable line; every surface goes through lineDisplay(), which
// decides between the exact figure and a band. Never render linePrice() of a
// line directly.
export type LinePrice = { placement: number; contentFee: number; total: number };

export function linePrice(
  item: Pick<EstimableListItem, "productId" | "product" | "quantity" | "withContent">,
  pricing: PlanPricing,
): LinePrice | null {
  const product = item.product;
  if (!item.productId || !product) return null;
  if (!isProductPriceShown(product, product.title)) return null;
  const placement = placementLineTotal(product, item.quantity, pricing.marginRules);
  const contentFee = item.withContent
    ? contentFeeFor(product, product.title.market.code, pricing.feeRules)
    : 0;
  return { placement, contentFee, total: placement + contentFee };
}

// THE rule for what a buyer sees on a plan line before a quote — the plan
// lines, the plan total, the catalog plan bar, the share page, the requests
// list and the campaign rail all ask this one function:
//
//   exact     — an instant-orderable line (FIRM + confirmed + price shown,
//               isInstantOrderable — the rule the instant path orders by).
//               The buyer can order it at this figure right now, so it is the
//               figure: the order's own split (placement + content fee).
//   band      — any other shown FLAT price: the line's estimate snapped to its
//               price band (bands.ts), exactly like the catalog. The figure is
//               the desk's to confirm, so publishing it exactly would both
//               overpromise and leak the rate card. `withContent` says whether
//               the band includes the article.
//   rate      — a shown CPM/CPC price that is not instant-orderable: its unit
//               rate, as the catalog shows it. A volume-priced line has no
//               placement figure to band.
//   onRequest — no shown price (unconfirmed, hidden, no product yet).
export type LineDisplay =
  | ({ kind: "exact" } & LinePrice)
  | { kind: "band"; band: Band; range: BandRange; withContent: boolean }
  | { kind: "rate"; rate: number; unit: string }
  | { kind: "onRequest" };

export function lineDisplay(
  item: Pick<EstimableListItem, "productId" | "product" | "quantity" | "withContent">,
  pricing: PlanPricing,
): LineDisplay {
  const product = item.product;
  const price = linePrice(item, pricing);
  if (!product || !price) return { kind: "onRequest" };
  if (isInstantOrderable(product, product.title)) return { kind: "exact", ...price };
  const rate = unitRate(product, product.title, pricing);
  if (rate) return { kind: "rate", rate: rate.rate, unit: rate.unit };
  const band = priceBand(price.total, product.currency);
  return { kind: "band", band, range: bandRange(band), withContent: item.withContent };
}

// A sortable magnitude for a line (the plan's "Price, highest first"). Sent to
// the client, so a banded line sorts by its band — never by its exact
// estimate, which would ship the hidden figure in the page payload.
export function lineSortValue(display: LineDisplay): number | null {
  switch (display.kind) {
    case "exact":
      return display.total;
    case "band":
      return display.range.high === null ? display.range.low * 1.5 : (display.range.low + display.range.high) / 2;
    default:
      return null;
  }
}

// Per-currency total for a saved list, built from lineDisplay so it mixes the
// two kinds honestly: the exact sum of the instant-orderable lines, plus the
// summed band range of the rest. Shared by /plan's summary, the catalog plan
// bar, the share page, the requests list and the campaign rail, so no surface
// shows a figure another one doesn't.
//
// itemCount travels alongside the amount so a plan spanning two currencies can
// say "SEK 95,565 for 4 titles + €92 for 1 title" instead of two bare figures —
// buyers reading "SEK X · €Y" side by side kept asking whether that meant a
// choice of currency to pay in, not two separate charges that both apply.
export type ListTotal = {
  currency: string;
  // EXACT part (instant-orderable lines), excluding VAT: placements plus
  // content fees. On an all-firm plan this is the subtotal the order carries.
  amount: number;
  // The content-production part of `amount` ("We write it" lines).
  contentFees: number;
  // VAT on `amount`, per placement market (the EUR markets share a currency
  // but not a rate), and `amount + vat` — what the buyer actually pays for
  // the exact part.
  vat: number;
  totalInclVat: number;
  hasExact: boolean;
  // BANDED part, excluding VAT: the sum of the band ranges of every other
  // priced line. Null when there is none.
  estimate: BandRange | null;
  // Lines with no figure in this total: a hidden/unconfirmed price, or a
  // rate-priced (CPM/CPC) line whose cost depends on volume. The line
  // registers its currency (so a tri-Nordic basket shows NOK + SEK + DKK rows
  // even when one of them has no figure yet) but adds nothing — not even its
  // content fee, so a known fee never mixes with an unknown placement.
  hasOnRequest: boolean;
  itemCount: number;
};

// What a surface needs to print one currency's total (lib/pricing/total-label.ts).
export type TotalFigure = Pick<ListTotal, "currency" | "amount" | "hasExact" | "estimate" | "itemCount">;

export function hasFigure(total: Pick<ListTotal, "hasExact" | "estimate">): boolean {
  return total.hasExact || total.estimate !== null;
}

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
      hasExact: false,
      estimate: null,
      hasOnRequest: false,
      itemCount: 0,
      byMarket: new Map(),
    };
    entry.itemCount += 1;
    const display = lineDisplay(item, pricing);
    if (display.kind === "exact") {
      const market = product.title.market;
      entry.amount += display.total;
      entry.contentFees += display.contentFee;
      entry.hasExact = true;
      const m = entry.byMarket.get(market.code) ?? { subtotal: 0, vatPct: Number(market.vatRatePct) };
      m.subtotal += display.total;
      entry.byMarket.set(market.code, m);
    } else if (display.kind === "band") {
      entry.estimate = addRanges(entry.estimate, display.range);
    } else {
      entry.hasOnRequest = true;
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

// Whether a plan has lines its total can't include yet: a line with no shown
// figure (hidden or unconfirmed price, a CPM/CPC rate) or a title not placed
// yet (no product). Such lines are priced later, so every surface that shows
// the total says "+ items priced on request" beside it — /plan's summary and
// the share page ask this one helper, so the two can't disagree about it
// (BUG-final-local-12: /plan hid a placeholder the share page announced).
export function hasUnpricedLines(
  items: readonly { isAlternative?: boolean; productId: string | null }[],
  totals: readonly Pick<ListTotal, "hasOnRequest">[],
): boolean {
  return totals.some((r) => r.hasOnRequest) || items.some((i) => !i.isAlternative && !i.productId);
}

// The catalog plan bar's figure: per-currency totals computed server-side by
// the same engine as /plan. Currencies with no figure at all are dropped (the
// bar says "priced by the desk" instead of 0).
export function barTotals(items: EstimableListItem[], pricing: PlanPricing): TotalFigure[] {
  return estimateListTotals(items, pricing)
    .filter(hasFigure)
    .map(({ currency, amount, hasExact, estimate, itemCount }) => ({
      currency,
      amount,
      hasExact,
      estimate,
      itemCount,
    }));
}

// Adds several totals per currency (a programme's waves into one programme
// total), keeping the exact and banded parts apart.
export function sumTotalFigures(groups: TotalFigure[][]): TotalFigure[] {
  const byCurrency = new Map<string, TotalFigure>();
  for (const group of groups) {
    for (const t of group) {
      const acc = byCurrency.get(t.currency);
      if (!acc) {
        byCurrency.set(t.currency, { ...t });
        continue;
      }
      acc.amount += t.amount;
      acc.hasExact ||= t.hasExact;
      acc.estimate = t.estimate ? addRanges(acc.estimate, t.estimate) : acc.estimate;
      acc.itemCount += t.itemCount;
    }
  }
  return [...byCurrency.values()];
}
