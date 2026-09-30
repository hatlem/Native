import { test } from "node:test";
import assert from "node:assert/strict";
import {
  barTotals,
  contentFeeFor,
  estimateListTotals,
  linePrice,
  placementLineTotal,
  planLineCount,
  type PlanPricing,
} from "./plan-total";
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

// BUG-prod-api-10: "We write it" showed "17 250 placement + 2 000 article"
// under a line figure of 17 250. The line figure is placement + fee, and the
// plan total is exactly the sum of the line figures.
test("linePrice: a We-write-it line's total includes its content fee", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  assert.deepEqual(linePrice(fakeItem({ basePrice: 15000, withContent: true }), pricing), {
    placement: 17250,
    contentFee: 12000,
    total: 29250,
  });
  assert.deepEqual(linePrice(fakeItem({ basePrice: 15000 }), pricing), {
    placement: 17250,
    contentFee: 0,
    total: 17250,
  });
});

test("linePrice: one content fee per line whatever the quantity", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  assert.deepEqual(linePrice(fakeItem({ basePrice: 1000, quantity: 3, withContent: true }), pricing), {
    placement: 3450,
    contentFee: 12000,
    total: 15450,
  });
});

test("linePrice: null for hidden prices and placeholders, never a 0 figure", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  assert.equal(linePrice(fakeItem({ confirmedAt: null, withContent: true }), pricing), null);
  assert.equal(linePrice(fakeItem({ productId: null }), pricing), null);
});

// BUG-prod-api-7: the catalog bar said "3 titles" for a 6-line plan.
test("planLineCount counts placeholders, never alternatives", () => {
  const items = [
    fakeItem({}),
    fakeItem({ productId: null }),
    { ...fakeItem({}), isAlternative: true },
  ];
  assert.equal(planLineCount(items), 2);
});

test("barTotals: server-priced totals, nothing for a currency with no priced line", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  const items = [
    fakeItem({ basePrice: 15000, withContent: true }),
    fakeItem({ currency: "SEK", confirmedAt: null }),
  ];
  assert.deepEqual(barTotals(items, pricing), [{ currency: "NOK", amount: 29250, itemCount: 1 }]);
});

test("estimateListTotals is exactly the sum of the linePrice totals", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  const items = [
    fakeItem({ basePrice: 15000, withContent: true }),
    fakeItem({ basePrice: 9000, quantity: 2, type: "NATIVE_DISPLAY", withContent: true }),
    fakeItem({ basePrice: 4000 }),
    fakeItem({ confirmedAt: null, withContent: true }),
  ];
  const lineSum = items.reduce((sum, i) => sum + (linePrice(i, pricing)?.total ?? 0), 0);
  const [total] = estimateListTotals(items, pricing);
  assert.equal(total.amount, lineSum);
  assert.equal(total.contentFees, 12000 + 8000);
});
