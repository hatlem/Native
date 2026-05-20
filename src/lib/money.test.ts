import { test } from "node:test";
import assert from "node:assert/strict";
import {
  indicativePrice,
  firmLineTotal,
  withVat,
  formatMoney,
  pickRule,
  computeQuoteLines,
  quoteTotals,
  toRateRules,
  indicativeFromRules,
  type RateRule,
} from "./money";

test("indicativePrice applies margin then seasonal multiplier", () => {
  assert.equal(indicativePrice(1000, 15), 1150);
  assert.equal(indicativePrice(1000, 15, 1.2), 1380);
  assert.equal(indicativePrice(1000, 0), 1000);
});

test("indicativePrice defaults seasonal multiplier to 1", () => {
  assert.equal(indicativePrice(2000, 25), indicativePrice(2000, 25, 1));
});

test("firmLineTotal multiplies the indicative unit price by quantity", () => {
  assert.equal(firmLineTotal(1000, 15, 3), 3450);
  assert.equal(firmLineTotal(1000, 15, 3, 2), 6900);
  assert.equal(firmLineTotal(500, 20, 1), indicativePrice(500, 20));
});

test("withVat adds the VAT percentage", () => {
  assert.equal(withVat(1000, 25), 1250);
  assert.equal(withVat(1000, 0), 1000);
  assert.equal(withVat(800, 12.5), 900);
});

test("formatMoney renders a zero-decimal currency string per locale", () => {
  const en = formatMoney(1234, "GBP", "en");
  assert.match(en, /1,234/);
  assert.ok(!en.includes("."), `expected no decimals, got ${en}`);
  // Unknown locale falls back to en-GB rather than throwing.
  assert.doesNotThrow(() => formatMoney(10, "EUR", "zz"));
});

const TIERS: RateRule[] = [
  { minVolume: 1, marginPct: 22, seasonalMultiplier: 1 },
  { minVolume: 3, marginPct: 18, seasonalMultiplier: 1 },
  { minVolume: 5, marginPct: 12, seasonalMultiplier: 1.1 },
];

test("pickRule selects the highest tier the quantity satisfies", () => {
  assert.equal(pickRule(TIERS, 1)?.marginPct, 22);
  assert.equal(pickRule(TIERS, 2)?.marginPct, 22);
  assert.equal(pickRule(TIERS, 3)?.marginPct, 18);
  assert.equal(pickRule(TIERS, 4)?.marginPct, 18);
  assert.equal(pickRule(TIERS, 9)?.marginPct, 12);
});

test("pickRule falls back to the lowest tier below every floor", () => {
  const highOnly: RateRule[] = [
    { minVolume: 10, marginPct: 8, seasonalMultiplier: 1 },
    { minVolume: 5, marginPct: 12, seasonalMultiplier: 1 },
  ];
  assert.equal(pickRule(highOnly, 1)?.minVolume, 5);
  assert.equal(pickRule([], 3), null);
});

test("computeQuoteLines applies the volume tier and rounds", () => {
  const [line] = computeQuoteLines([
    { productId: "p1", name: "Native article", quantity: 3, basePrice: 1000, rules: TIERS },
  ]);
  // qty 3 -> 18% margin tier: 1000 * 1.18 * 1 * 3 = 3540
  assert.equal(line.marginPct, 18);
  assert.equal(line.lineTotal, 3540);
  assert.equal(line.unitCost, 1000);
  assert.equal(line.description, "Native article");
});

test("computeQuoteLines falls back to the default margin with no rules", () => {
  const [line] = computeQuoteLines([
    { productId: "p2", name: "X", quantity: 1, basePrice: 1000, rules: [] },
  ]);
  // default 15% margin: 1000 * 1.15 = 1150
  assert.equal(line.marginPct, 15);
  assert.equal(line.lineTotal, 1150);
});

test("computeQuoteLines applies the seasonal multiplier", () => {
  const [line] = computeQuoteLines([
    { productId: "p3", name: "Display", quantity: 5, basePrice: 2000, rules: TIERS },
  ]);
  // qty 5 -> 12% margin, 1.1 seasonal: 2000 * 1.12 * 1.1 * 5 = 12320
  assert.equal(line.lineTotal, 12320);
});

test("quoteTotals sums lines and rounds VAT", () => {
  const { subtotal, total } = quoteTotals(
    [{ lineTotal: 3540 }, { lineTotal: 1150 }],
    25,
  );
  assert.equal(subtotal, 4690);
  assert.equal(total, 5863); // 4690 * 1.25 = 5862.5 -> 5863
});

test("toRateRules coerces Decimal-like values to numbers", () => {
  const rules = toRateRules([
    { marginPct: "22", seasonalMultiplier: "1.1", minVolume: 1 },
  ]);
  assert.deepEqual(rules, [
    { marginPct: 22, seasonalMultiplier: 1.1, minVolume: 1 },
  ]);
});

test("indicativeFromRules uses the tier for the given quantity", () => {
  // qty 1 -> standard 22%: 1000 * 1.22 = 1220
  assert.equal(indicativeFromRules(1000, TIERS, 1), 1220);
  // qty 3 -> 18%: 1000 * 1.18 = 1180
  assert.equal(indicativeFromRules(1000, TIERS, 3), 1180);
  // no rules -> default 15%: 1000 * 1.15 = 1150
  assert.equal(indicativeFromRules(1000, [], 1), 1150);
});
