import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arePricesVisible,
  allPricesVisible,
  anyHiddenPrices,
} from "./pricing-visibility";

test("arePricesVisible defaults to true when fields are missing", () => {
  assert.equal(arePricesVisible({}), true);
  assert.equal(arePricesVisible({ publisher: {} }), true);
  assert.equal(arePricesVisible({ pricesPublic: undefined }), true);
});

test("arePricesVisible cascades publisher AND title", () => {
  assert.equal(
    arePricesVisible({
      pricesPublic: true,
      publisher: { pricesPublic: true },
    }),
    true,
  );
  assert.equal(
    arePricesVisible({
      pricesPublic: false,
      publisher: { pricesPublic: true },
    }),
    false,
  );
  assert.equal(
    arePricesVisible({
      pricesPublic: true,
      publisher: { pricesPublic: false },
    }),
    false,
  );
  assert.equal(
    arePricesVisible({
      pricesPublic: false,
      publisher: { pricesPublic: false },
    }),
    false,
  );
});

test("nulls are treated as 'unset' and default to visible", () => {
  assert.equal(
    arePricesVisible({
      pricesPublic: null,
      publisher: { pricesPublic: null },
    }),
    true,
  );
});

test("allPricesVisible requires every title to be visible", () => {
  assert.equal(
    allPricesVisible([
      { pricesPublic: true, publisher: { pricesPublic: true } },
      { pricesPublic: true, publisher: { pricesPublic: true } },
    ]),
    true,
  );
  assert.equal(
    allPricesVisible([
      { pricesPublic: true, publisher: { pricesPublic: true } },
      { pricesPublic: false, publisher: { pricesPublic: true } },
    ]),
    false,
  );
  assert.equal(allPricesVisible([]), true);
});

test("anyHiddenPrices is the inverse of allPricesVisible for non-empty inputs", () => {
  const titles = [
    { pricesPublic: true, publisher: { pricesPublic: true } },
    { pricesPublic: false, publisher: { pricesPublic: true } },
  ];
  assert.equal(anyHiddenPrices(titles), true);
  assert.equal(allPricesVisible(titles), false);
});

