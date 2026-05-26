import { test } from "node:test";
import assert from "node:assert/strict";
import { validateQuoteInput } from "./quotes";

test("validateQuoteInput accepts a complete existing-product quote", () => {
  const v = validateQuoteInput({
    productId: "p1",
    price: 1000,
    currency: "EUR",
  });
  assert.equal(v.ok, true);
});

test("validateQuoteInput accepts a draft quote", () => {
  const v = validateQuoteInput({
    draftProductType: "OTHER",
    draftProductName: "Newsletter",
    price: 500,
    currency: "NOK",
  });
  assert.equal(v.ok, true);
});

test("validateQuoteInput rejects both productId and draft", () => {
  const v = validateQuoteInput({
    productId: "p1",
    draftProductType: "OTHER",
    draftProductName: "Newsletter",
    price: 500,
    currency: "NOK",
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.reason, /both/);
});

test("validateQuoteInput rejects neither productId nor draft", () => {
  const v = validateQuoteInput({
    price: 500,
    currency: "NOK",
  });
  assert.equal(v.ok, false);
});

test("validateQuoteInput rejects non-positive price", () => {
  const v = validateQuoteInput({
    productId: "p1",
    price: 0,
    currency: "EUR",
  });
  assert.equal(v.ok, false);
});

test("validateQuoteInput rejects bad currency code", () => {
  const v = validateQuoteInput({
    productId: "p1",
    price: 100,
    currency: "EU",
  });
  assert.equal(v.ok, false);
});
