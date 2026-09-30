import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateListTotals, placementLineTotal, contentFeeFor, planBarSummary, type PlanPricing } from "./plan-total";
import {
  computeContentFeeLines,
  computeQuoteLines,
  quoteTotals,
  type ContentFeeRuleSpec,
} from "./money";
import type { UnsentList } from "./lists";

type FakeItem = UnsentList["items"][number];

const NO_PRICING: PlanPricing = { feeRules: [], marginRules: [] };

// The rules the E2E run hit: a NO native-display article costs 8 000, any
// other NO product 12 000.
const NO_FEES: ContentFeeRuleSpec[] = [
  { marketCode: "NO", productType: null, currency: "NOK", greenfieldFee: 12000, adaptationFee: 6000, active: true },
  { marketCode: "NO", productType: "NATIVE_DISPLAY", currency: "NOK", greenfieldFee: 8000, adaptationFee: null, active: true },
];

function fakeItem(overrides: {
  productId?: string | null;
  currency?: string;
  basePrice?: number;
  quantity?: number;
  active?: boolean;
  confirmedAt?: Date | null;
  pricesPublic?: boolean | null;
  withContent?: boolean;
  type?: string;
  marketCode?: string;
  vatRatePct?: number;
  priceRules?: { marginPct: number; seasonalMultiplier: number; minVolume: number }[];
}): FakeItem {
  const {
    productId = "prod-1",
    currency = "NOK",
    basePrice = 1000,
    quantity = 1,
    active = true,
    confirmedAt = new Date("2026-01-01"),
    pricesPublic = true,
    withContent = false,
    type = "NATIVE_ARTICLE",
    marketCode = "NO",
    vatRatePct = 25,
    priceRules = [],
  } = overrides;
  return {
    productId,
    quantity,
    withContent,
    product: productId
      ? {
          type,
          currency,
          basePrice,
          active,
          confirmedAt,
          priceRules,
          title: { pricesPublic, publisher: null, market: { code: marketCode, vatRatePct } },
        }
      : null,
  } as unknown as FakeItem;
}

test("sums visible-price lines into a single currency total", () => {
  const items = [
    fakeItem({ basePrice: 1000, quantity: 2 }),
    fakeItem({ basePrice: 500, quantity: 1 }),
  ];
  const totals = estimateListTotals(items, NO_PRICING);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].currency, "NOK");
  // Default 15 % margin, rounded per line like the order: 2 300 + 575.
  assert.equal(totals[0].amount, 2875);
  assert.equal(totals[0].hasHidden, false);
  assert.equal(totals[0].hasVisible, true);
});

test("splits totals by currency", () => {
  const items = [
    fakeItem({ currency: "NOK", basePrice: 1000 }),
    fakeItem({ currency: "SEK", basePrice: 2000, marketCode: "SE" }),
  ];
  const totals = estimateListTotals(items, NO_PRICING);
  const currencies = totals.map((t) => t.currency).sort();
  assert.deepEqual(currencies, ["NOK", "SEK"]);
});

test("a hidden-price line registers its currency without adding to amount", () => {
  const items = [fakeItem({ currency: "DKK", pricesPublic: false })];
  const totals = estimateListTotals(items, NO_PRICING);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].amount, 0);
  assert.equal(totals[0].hasHidden, true);
  assert.equal(totals[0].hasVisible, false);
});

test("an unconfirmed product counts as hidden, not visible", () => {
  const items = [fakeItem({ confirmedAt: null })];
  const totals = estimateListTotals(items, NO_PRICING);
  assert.equal(totals[0].amount, 0);
  assert.equal(totals[0].hasHidden, true);
});

test("a title placeholder line (no product) is skipped entirely", () => {
  const items = [fakeItem({ productId: null })];
  const totals = estimateListTotals(items, NO_PRICING);
  assert.deepEqual(totals, []);
});

test("empty item list returns no totals", () => {
  assert.deepEqual(estimateListTotals([], NO_PRICING), []);
});

test("estimateListTotals skips recommended alternatives", () => {
  const plan = fakeItem({ productId: "p1", basePrice: 1000 });
  const alt = { ...fakeItem({ productId: "p2", basePrice: 5000 }), isAlternative: true } as FakeItem;
  const [total] = estimateListTotals([plan, alt], NO_PRICING);
  assert.equal(total.itemCount, 1);
  assert.deepEqual(estimateListTotals([alt], NO_PRICING), []);
});

// ── Content fees: the total is what the order charges ──────────────────────

test("a 'We write it' line adds its content fee to the total", () => {
  const items = [fakeItem({ basePrice: 10000, withContent: true, type: "NATIVE_DISPLAY" })];
  const [total] = estimateListTotals(items, { feeRules: NO_FEES, marginRules: [] });
  // 11 500 placement + 8 000 article (the type-specific rule beats the NO wildcard).
  assert.equal(total.contentFees, 8000);
  assert.equal(total.amount, 19500);
});

test("the content fee is one per line, not per insertion", () => {
  const items = [fakeItem({ basePrice: 1000, quantity: 3, withContent: true })];
  const [total] = estimateListTotals(items, { feeRules: NO_FEES, marginRules: [] });
  assert.equal(total.contentFees, 12000);
});

test("no fee without 'We write it', and none when no rule matches (as the order)", () => {
  const off = estimateListTotals([fakeItem({ withContent: false })], { feeRules: NO_FEES, marginRules: [] });
  assert.equal(off[0].contentFees, 0);
  const noRule = estimateListTotals([fakeItem({ withContent: true, marketCode: "SE", currency: "SEK" })], {
    feeRules: NO_FEES,
    marginRules: [],
  });
  assert.equal(noRule[0].contentFees, 0);
});

test("a hidden-price line adds no content fee either", () => {
  const [total] = estimateListTotals([fakeItem({ pricesPublic: false, withContent: true })], {
    feeRules: NO_FEES,
    marginRules: [],
  });
  assert.equal(total.amount, 0);
  assert.equal(total.contentFees, 0);
});

test("VAT is added per placement market and stated separately", () => {
  const items = [fakeItem({ basePrice: 10000, withContent: true, type: "NATIVE_DISPLAY" })];
  const [total] = estimateListTotals(items, { feeRules: NO_FEES, marginRules: [] });
  assert.equal(total.vat, 4875); // 25 % of 19 500
  assert.equal(total.totalInclVat, 24375);
});

test("two EUR markets keep their own VAT rates", () => {
  const items = [
    fakeItem({ currency: "EUR", basePrice: 1000, marketCode: "DE", vatRatePct: 19 }),
    fakeItem({ currency: "EUR", basePrice: 1000, marketCode: "IE", vatRatePct: 23 }),
  ];
  const [total] = estimateListTotals(items, NO_PRICING);
  assert.equal(total.amount, 2300);
  assert.equal(total.totalInclVat, Math.round(1150 * 1.19) + Math.round(1150 * 1.23));
});

test("the plan total equals what the firm order computes for the same lines", () => {
  // Mirror createFirmOrder: computeQuoteLines + contentFeeLinesForGroup +
  // quoteTotals for one market. A market margin rule (not the global default)
  // and a volume tier are both in play, so any drift would show.
  const pricing: PlanPricing = {
    feeRules: NO_FEES,
    marginRules: [{ marketCode: "NO", marginPct: 20, active: true }],
  };
  const tiered = [{ marginPct: 12, seasonalMultiplier: 1.1, minVolume: 2 }];
  const items = [
    fakeItem({ productId: "a", basePrice: 15427, withContent: true, type: "NATIVE_DISPLAY" }),
    fakeItem({ productId: "b", basePrice: 3333, quantity: 2, priceRules: tiered }),
  ];
  const [total] = estimateListTotals(items, pricing);

  const orderLines = [
    ...computeQuoteLines(
      [
        { productId: "a", name: "a", quantity: 1, basePrice: 15427, rules: [] },
        { productId: "b", name: "b", quantity: 2, basePrice: 3333, rules: tiered },
      ],
      20,
    ),
    ...computeContentFeeLines([{ name: "a", productType: "NATIVE_DISPLAY" }], NO_FEES, "NO"),
  ];
  const order = quoteTotals(orderLines, 25);
  assert.equal(total.amount, order.subtotal);
  assert.equal(total.totalInclVat, order.total);
});

test("placementLineTotal and contentFeeFor expose the per-line figures", () => {
  const product = { basePrice: 1000, priceRules: [], title: { market: { code: "NO" } } };
  assert.equal(placementLineTotal(product, 2, []), 2300);
  assert.equal(placementLineTotal(product, 2, [{ marketCode: "NO", marginPct: 10, active: true }]), 2200);
  assert.equal(contentFeeFor("NATIVE_DISPLAY", "NO", NO_FEES), 8000);
  assert.equal(contentFeeFor("NATIVE_DISPLAY", "SE", NO_FEES), 0);
});

// ── The catalog's plan bar ──────────────────────────────────────────────────

test("planBarSummary: the customer price (never the net base price), fees in, alternatives out", () => {
  const withTitle = (i: FakeItem, titleId: string | null = null) => ({ ...i, titleId });
  const items = [
    withTitle(fakeItem({ productId: "p1", basePrice: 1000 })),
    withTitle(fakeItem({ productId: "p2", basePrice: 10000, withContent: true, type: "NATIVE_DISPLAY" })),
    withTitle({ ...fakeItem({ productId: "p3", basePrice: 5000 }), isAlternative: true } as FakeItem),
    withTitle(fakeItem({ productId: null }), "title-1"),
  ];
  const summary = planBarSummary(items, { feeRules: NO_FEES, marginRules: [] });
  assert.deepEqual(summary.productIds, ["p1", "p2"]);
  // Two placements + one not-yet-placed title; the alternative isn't on the plan.
  assert.equal(summary.count, 3);
  // 1 150 + 11 500 + 8 000 article: what /plan shows. The net 1 000 would be
  // a margin leak on a browse surface.
  assert.deepEqual(summary.totals, [{ currency: "NOK", amount: 20650, itemCount: 2 }]);
});

test("planBarSummary: hidden-price lines add no figure", () => {
  const summary = planBarSummary([{ ...fakeItem({ pricesPublic: false }), titleId: null }], NO_PRICING);
  assert.equal(summary.count, 1);
  assert.deepEqual(summary.totals, []);
});
