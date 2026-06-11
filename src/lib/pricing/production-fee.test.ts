import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProductionFee } from "./production-fee";
import type { ContentFeeRuleSpec } from "../money";

const RULES: ContentFeeRuleSpec[] = [
  {
    marketCode: "NO",
    productType: "NATIVE_ARTICLE",
    currency: "NOK",
    greenfieldFee: 2000,
    adaptationFee: null,
    active: true,
  },
  {
    marketCode: "NO",
    productType: null,
    currency: "NOK",
    greenfieldFee: 1000,
    adaptationFee: null,
    active: true,
  },
];

test("product-level fee wins over everything", () => {
  const fee = resolveProductionFee({
    productFee: 3500,
    titleFee: 2500,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 3500);
});

test("explicit 0 at product level short-circuits (publisher includes production)", () => {
  const fee = resolveProductionFee({
    productFee: 0,
    titleFee: 2500,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 0);
});

test("title-level default used when product fee unset", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: 2500,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 2500);
});

test("explicit 0 at title level short-circuits", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: 0,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 0);
});

test("falls through to most-specific ContentFeeRule", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: null,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 2000); // the NATIVE_ARTICLE+NO rule, not the NO wildcard
});

test("wildcard rule used for other product types", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: null,
    productType: "NATIVE_DISPLAY",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 1000);
});

test("no matching rule → 0 (band still renders)", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: null,
    productType: "NATIVE_ARTICLE",
    marketCode: "DE",
    rules: RULES,
  });
  assert.equal(fee, 0);
});
