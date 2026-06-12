import { test } from "node:test";
import assert from "node:assert/strict";
import { customerPrice, productBand, titleBand, titleRate, unitRate } from "./display-price";
import type { PricingDefaults } from "@/lib/content-fee";
import type { ContentFeeRuleSpec } from "../money";

const RULES: ContentFeeRuleSpec[] = [
  {
    marketCode: "NO",
    productType: null,
    currency: "NOK",
    greenfieldFee: 2000,
    adaptationFee: null,
    active: true,
  },
];

// No admin margin rules → the hardcoded 15% default applies.
const DEFAULTS: PricingDefaults = { feeRules: RULES, marginRules: [] };

const CONFIRMED = new Date("2026-06-01");

// Minimal structural fixtures — display-price must accept plain objects
// (Prisma Decimals arrive as `unknown`-ish; Number() at the boundary).
function product(over: Record<string, unknown> = {}) {
  return {
    active: true,
    confirmedAt: CONFIRMED,
    type: "NATIVE_ARTICLE",
    basePrice: 30_000,
    currency: "NOK",
    priceRules: [], // empty → default margin applies
    productionFee: null,
    ...over,
  };
}

const TITLE = {
  pricesPublic: true,
  publisher: { pricesPublic: true },
  productionFeeDefault: null,
  market: { code: "NO" },
};

test("customerPrice = round(indicative) + resolved fee", () => {
  // No margin rules → 15% fallback: 30_000 × 1.15 = 34_500 → + 2_000 = 36_500
  assert.equal(customerPrice(product(), TITLE, DEFAULTS), 36_500);
});

test("global MarginRule replaces the hardcoded default", () => {
  // 30_000 × 1.20 = 36_000 → + 2_000 ContentFeeRule = 38_000
  const defaults: PricingDefaults = {
    feeRules: RULES,
    marginRules: [{ marketCode: null, marginPct: 20, active: true }],
  };
  assert.equal(customerPrice(product(), TITLE, defaults), 38_000);
});

test("market-specific MarginRule beats the global one", () => {
  // NO 25% wins over global 10%: 30_000 × 1.25 = 37_500 → + 2_000 = 39_500
  const defaults: PricingDefaults = {
    feeRules: RULES,
    marginRules: [
      { marketCode: null, marginPct: 10, active: true },
      { marketCode: "NO", marginPct: 25, active: true },
    ],
  };
  assert.equal(customerPrice(product(), TITLE, defaults), 39_500);
});

test("explicit productionFee 0 on the product suppresses the fee", () => {
  assert.equal(
    customerPrice(product({ productionFee: 0 }), TITLE, DEFAULTS),
    34_500,
  );
});

test("productBand is null for unconfirmed products", () => {
  assert.equal(
    productBand(product({ confirmedAt: null }), TITLE, DEFAULTS),
    null,
  );
});

test("productBand is null when publisher hides prices", () => {
  const hidden = { ...TITLE, publisher: { pricesPublic: false } };
  assert.equal(productBand(product(), hidden, DEFAULTS), null);
});

test("productBand bands the all-in customer price", () => {
  // 36_500 → NOK bucket 25–40k
  assert.deepEqual(productBand(product(), TITLE, DEFAULTS), {
    kind: "range",
    low: 25_000,
    high: 40_000,
  });
});

test("titleBand prefers NATIVE_ARTICLE over a cheaper display product", () => {
  // The bait-band regression guard: a 5k display must NOT produce the
  // card band when a 30k article is shown.
  const display = product({ type: "NATIVE_DISPLAY", basePrice: 5_000 });
  const article = product(); // 36_500 all-in
  const got = titleBand([display, article], TITLE, DEFAULTS);
  assert.ok(got);
  assert.equal(got.product.type, "NATIVE_ARTICLE");
  assert.deepEqual(got.band, { kind: "range", low: 25_000, high: 40_000 });
});

test("titleBand falls back to the cheapest shown product", () => {
  const a = product({ type: "ADVERTORIAL", basePrice: 80_000 });
  const b = product({ type: "NATIVE_DISPLAY", basePrice: 5_000 });
  const got = titleBand([a, b], TITLE, DEFAULTS);
  assert.ok(got);
  assert.equal(got.product.type, "NATIVE_DISPLAY");
});

test("titleBand skips hidden products when choosing", () => {
  const hiddenArticle = product({ confirmedAt: null });
  const shownDisplay = product({ type: "NATIVE_DISPLAY", basePrice: 5_000 });
  const got = titleBand([hiddenArticle, shownDisplay], TITLE, DEFAULTS);
  assert.ok(got);
  assert.equal(got.product.type, "NATIVE_DISPLAY");
});

test("titleBand is null when nothing is shown", () => {
  assert.equal(
    titleBand([product({ confirmedAt: null })], TITLE, DEFAULTS),
    null,
  );
});

test("CPM products never band; unitRate returns marked-up rounded rate", () => {
  const cpm = product({ pricingModel: "CPM", basePrice: 345 });
  assert.equal(productBand(cpm, TITLE, { feeRules: RULES, marginRules: [] }), null);
  const got = unitRate(cpm, TITLE, { feeRules: RULES, marginRules: [] });
  // 345 × 1.15 = 396.75 → nearest 5 = 395; no production fee folded in
  assert.deepEqual(got, { rate: 395, unit: "CPM" });
});

test("titleBand ignores rate products when picking the card band", () => {
  const cpm = product({ pricingModel: "CPM", basePrice: 100 });
  const flat = product({ type: "ADVERTORIAL", basePrice: 30_000 });
  const got = titleBand([cpm, flat], TITLE, { feeRules: RULES, marginRules: [] });
  assert.ok(got);
  assert.equal(got.product.type, "ADVERTORIAL");
});

test("unitRate is null for FLAT and for hidden rate products", () => {
  assert.equal(unitRate(product(), TITLE, { feeRules: RULES, marginRules: [] }), null);
  const hidden = product({ pricingModel: "CPM", confirmedAt: null });
  assert.equal(unitRate(hidden, TITLE, { feeRules: RULES, marginRules: [] }), null);
});

test("titleRate falls back to the cheapest shown unit rate when no flat band exists", () => {
  const cpmHigh = product({ pricingModel: "CPM", basePrice: 500, type: "NATIVE_DISPLAY" });
  const cpmLow = product({ pricingModel: "CPM", basePrice: 343, type: "NATIVE_DISPLAY" });
  const got = titleRate([cpmHigh, cpmLow], TITLE, DEFAULTS);
  assert.ok(got);
  // 343 × 1.15 = 394.45 → nearest 5 = 395
  assert.equal(got.rate, 395);
  assert.equal(got.unit, "CPM");
});

test("titleRate is null when only FLAT products exist (band owns the card)", () => {
  assert.equal(titleRate([product()], TITLE, DEFAULTS), null);
});
