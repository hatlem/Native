import { test } from "node:test";
import assert from "node:assert/strict";
import { isProductPriceShown } from "./visibility";

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
