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
  pickContentFeeRule,
  contentFeeAmount,
  computeContentFeeLines,
  type RateRule,
  type ContentFeeRuleSpec,
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

// ---------- Content-fee pricing ----------

const FEE_RULES: ContentFeeRuleSpec[] = [
  { marketCode: null, productType: null, currency: "NOK", greenfieldFee: 8000, adaptationFee: 4000, active: true },
  { marketCode: null, productType: "NATIVE_ARTICLE", currency: "NOK", greenfieldFee: 12000, adaptationFee: 6000, active: true },
  { marketCode: "NO", productType: "NATIVE_ARTICLE", currency: "NOK", greenfieldFee: 15000, adaptationFee: 7000, active: true },
  { marketCode: "SE", productType: "NATIVE_ARTICLE", currency: "SEK", greenfieldFee: 14000, adaptationFee: 7000, active: false },
];

test("pickContentFeeRule prefers the most specific active match", () => {
  // NO + NATIVE_ARTICLE -> the market+type rule
  assert.equal(pickContentFeeRule(FEE_RULES, "NATIVE_ARTICLE", "NO")?.greenfieldFee, 15000);
  // DK + NATIVE_ARTICLE -> falls back to the type-only rule (no DK rule)
  assert.equal(pickContentFeeRule(FEE_RULES, "NATIVE_ARTICLE", "DK")?.greenfieldFee, 12000);
  // NO + ADVERTORIAL -> falls back to the global rule
  assert.equal(pickContentFeeRule(FEE_RULES, "ADVERTORIAL", "NO")?.greenfieldFee, 8000);
});

test("pickContentFeeRule ignores inactive rules", () => {
  // SE + NATIVE_ARTICLE rule is inactive -> falls back to type-only
  assert.equal(pickContentFeeRule(FEE_RULES, "NATIVE_ARTICLE", "SE")?.greenfieldFee, 12000);
});

test("pickContentFeeRule returns null when nothing matches", () => {
  const onlyType: ContentFeeRuleSpec[] = [
    { marketCode: null, productType: "ADVERTORIAL", currency: "NOK", greenfieldFee: 5000, adaptationFee: null, active: true },
  ];
  assert.equal(pickContentFeeRule(onlyType, "NATIVE_ARTICLE", "NO"), null);
});

test("contentFeeAmount picks greenfield or adaptation", () => {
  const rule = FEE_RULES[2];
  assert.equal(contentFeeAmount(rule), 15000);
  assert.equal(contentFeeAmount(rule, true), 7000);
  // adaptation falls back to greenfield when no adaptation fee set
  const noAdapt: ContentFeeRuleSpec = { ...rule, adaptationFee: null };
  assert.equal(contentFeeAmount(noAdapt, true), 15000);
});

test("computeContentFeeLines builds one CONTENT_FEE line per matched item", () => {
  const lines = computeContentFeeLines(
    [
      { name: "Aftenposten native", productType: "NATIVE_ARTICLE" },
      { name: "VG display", productType: "NATIVE_DISPLAY" },
    ],
    FEE_RULES,
    "NO",
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0].kind, "CONTENT_FEE");
  assert.equal(lines[0].productId, null);
  assert.equal(lines[0].lineTotal, 15000); // NO + NATIVE_ARTICLE
  assert.equal(lines[1].lineTotal, 8000); // global fallback
  assert.equal(lines[0].description, "Content production — Aftenposten native");
});

test("computeContentFeeLines skips items with no matching rule", () => {
  const lines = computeContentFeeLines(
    [{ name: "X", productType: "NATIVE_ARTICLE" }],
    [
      { marketCode: null, productType: "ADVERTORIAL", currency: "NOK", greenfieldFee: 5000, adaptationFee: null, active: true },
    ],
    "NO",
  );
  assert.equal(lines.length, 0);
});
