import { test } from "node:test";
import assert from "node:assert/strict";
import { customerPrice, productBand, titleBand } from "./display-price";
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
    priceRules: [], // empty → DEFAULT_MARGIN_PCT (15%) applies
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
  // 30_000 × 1.15 = 34_500 → + 2_000 ContentFeeRule = 36_500
  assert.equal(customerPrice(product(), TITLE, RULES), 36_500);
});

test("explicit productionFee 0 on the product suppresses the fee", () => {
  assert.equal(
    customerPrice(product({ productionFee: 0 }), TITLE, RULES),
    34_500,
  );
});

test("productBand is null for unconfirmed products", () => {
  assert.equal(
    productBand(product({ confirmedAt: null }), TITLE, RULES),
    null,
  );
});

test("productBand is null when publisher hides prices", () => {
  const hidden = { ...TITLE, publisher: { pricesPublic: false } };
  assert.equal(productBand(product(), hidden, RULES), null);
});

test("productBand bands the all-in customer price", () => {
  // 36_500 → NOK bucket 25–40k
  assert.deepEqual(productBand(product(), TITLE, RULES), {
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
  const got = titleBand([display, article], TITLE, RULES);
  assert.ok(got);
  assert.equal(got.product.type, "NATIVE_ARTICLE");
  assert.deepEqual(got.band, { kind: "range", low: 25_000, high: 40_000 });
});

test("titleBand falls back to the cheapest shown product", () => {
  const a = product({ type: "ADVERTORIAL", basePrice: 80_000 });
  const b = product({ type: "NATIVE_DISPLAY", basePrice: 5_000 });
  const got = titleBand([a, b], TITLE, RULES);
  assert.ok(got);
  assert.equal(got.product.type, "NATIVE_DISPLAY");
});

test("titleBand skips hidden products when choosing", () => {
  const hiddenArticle = product({ confirmedAt: null });
  const shownDisplay = product({ type: "NATIVE_DISPLAY", basePrice: 5_000 });
  const got = titleBand([hiddenArticle, shownDisplay], TITLE, RULES);
  assert.ok(got);
  assert.equal(got.product.type, "NATIVE_DISPLAY");
});

test("titleBand is null when nothing is shown", () => {
  assert.equal(
    titleBand([product({ confirmedAt: null })], TITLE, RULES),
    null,
  );
});
