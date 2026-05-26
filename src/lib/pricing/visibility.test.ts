import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isProductPriceShown,
  redactProductPricing,
} from "./visibility";

const visibleTitle = { pricesPublic: true, publisher: { pricesPublic: true } };
const hiddenTitle = { pricesPublic: false, publisher: { pricesPublic: true } };

test("isProductPriceShown requires active product", () => {
  assert.equal(
    isProductPriceShown({ active: false, confirmedAt: new Date() }, visibleTitle),
    false,
  );
});

test("isProductPriceShown requires confirmedAt non-null", () => {
  assert.equal(
    isProductPriceShown({ active: true, confirmedAt: null }, visibleTitle),
    false,
  );
});

test("isProductPriceShown requires title visibility", () => {
  assert.equal(
    isProductPriceShown({ active: true, confirmedAt: new Date() }, hiddenTitle),
    false,
  );
});

test("isProductPriceShown returns true when all three gates pass", () => {
  assert.equal(
    isProductPriceShown({ active: true, confirmedAt: new Date() }, visibleTitle),
    true,
  );
});

test("redactProductPricing redacts when confirmedAt is null", () => {
  const product = {
    basePrice: "1000",
    currency: "EUR",
    visibility: "FIRM",
    active: true,
    confirmedAt: null,
  };
  const out = redactProductPricing(product, visibleTitle);
  assert.equal(out.basePrice, null);
  assert.equal(out.visibility, "INDICATIVE");
  assert.equal(out.priceVisible, false);
  assert.equal(out.currency, "EUR");
});

test("redactProductPricing keeps price when confirmed + visible", () => {
  const product = {
    basePrice: "1000",
    currency: "EUR",
    visibility: "FIRM",
    active: true,
    confirmedAt: new Date(),
  };
  const out = redactProductPricing(product, visibleTitle);
  assert.equal(out.basePrice, "1000");
  assert.equal(out.priceVisible, true);
});
