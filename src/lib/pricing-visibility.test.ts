import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arePricesVisible,
  allPricesVisible,
  anyHiddenPrices,
  redactProductPricing,
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

test("redactProductPricing strips price when hidden, preserves when visible", () => {
  const visible = redactProductPricing(
    { basePrice: "1000", currency: "EUR", visibility: "FIRM", name: "X", active: true, confirmedAt: new Date() },
    { pricesPublic: true, publisher: { pricesPublic: true } },
  );
  assert.equal(visible.basePrice, "1000");
  assert.equal(visible.visibility, "FIRM");
  assert.equal(visible.priceVisible, true);
  assert.equal((visible as { name: string }).name, "X");

  const hidden = redactProductPricing(
    { basePrice: "1000", currency: "EUR", visibility: "FIRM", name: "X", active: true, confirmedAt: new Date() },
    { pricesPublic: false, publisher: { pricesPublic: true } },
  );
  assert.equal(hidden.basePrice, null);
  // Demoted to INDICATIVE so consumers never think they can checkout
  // against a price they can't see.
  assert.equal(hidden.visibility, "INDICATIVE");
  assert.equal(hidden.priceVisible, false);
  // Currency stays — useful as a hint for the "Request price (EUR)" UI.
  assert.equal(hidden.currency, "EUR");
});
