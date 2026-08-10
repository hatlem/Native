import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateListTotals } from "./plan-total";
import type { UnsentList } from "./lists";

type FakeItem = UnsentList["items"][number];

function fakeItem(overrides: {
  productId?: string | null;
  currency?: string;
  basePrice?: number;
  quantity?: number;
  active?: boolean;
  confirmedAt?: Date | null;
  pricesPublic?: boolean | null;
}): FakeItem {
  const {
    productId = "prod-1",
    currency = "NOK",
    basePrice = 1000,
    quantity = 1,
    active = true,
    confirmedAt = new Date("2026-01-01"),
    pricesPublic = true,
  } = overrides;
  return {
    productId,
    quantity,
    product: productId
      ? {
          currency,
          basePrice,
          active,
          confirmedAt,
          priceRules: [],
          title: { pricesPublic, publisher: null },
        }
      : null,
  } as unknown as FakeItem;
}

test("sums visible-price lines into a single currency total", () => {
  const items = [
    fakeItem({ basePrice: 1000, quantity: 2 }),
    fakeItem({ basePrice: 500, quantity: 1 }),
  ];
  const totals = estimateListTotals(items);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].currency, "NOK");
  assert.ok(totals[0].amount > 0);
  assert.equal(totals[0].hasHidden, false);
});

test("splits totals by currency", () => {
  const items = [
    fakeItem({ currency: "NOK", basePrice: 1000 }),
    fakeItem({ currency: "SEK", basePrice: 2000 }),
  ];
  const totals = estimateListTotals(items);
  const currencies = totals.map((t) => t.currency).sort();
  assert.deepEqual(currencies, ["NOK", "SEK"]);
});

test("a hidden-price line registers its currency without adding to amount", () => {
  const items = [fakeItem({ currency: "DKK", pricesPublic: false })];
  const totals = estimateListTotals(items);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].amount, 0);
  assert.equal(totals[0].hasHidden, true);
});

test("an unconfirmed product counts as hidden, not visible", () => {
  const items = [fakeItem({ confirmedAt: null })];
  const totals = estimateListTotals(items);
  assert.equal(totals[0].amount, 0);
  assert.equal(totals[0].hasHidden, true);
});

test("a title placeholder line (no product) is skipped entirely", () => {
  const items = [fakeItem({ productId: null })];
  const totals = estimateListTotals(items);
  assert.deepEqual(totals, []);
});

test("empty item list returns no totals", () => {
  assert.deepEqual(estimateListTotals([]), []);
});
