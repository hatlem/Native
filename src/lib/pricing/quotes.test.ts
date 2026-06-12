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

test("validateQuoteInput accepts valid structured inclusions", () => {
  const v = validateQuoteInput({
    productId: "p1",
    price: 1000,
    currency: "EUR",
    inclusions: {
      production: "PUBLISHER",
      viewsTotal: 25000,
      frontpage: true,
      socialChannels: ["Facebook", "Instagram"],
      sovPct: 100,
      durationWeeks: 2,
    },
  });
  assert.equal(v.ok, true);
});

test("validateQuoteInput rejects inclusions with invalid production value", () => {
  const v = validateQuoteInput({
    productId: "p1",
    price: 1000,
    currency: "EUR",
    inclusions: { production: "WRONG" },
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "quote.invalid_inclusions");
});

test("validateQuoteInput rejects inclusions with an unknown field (strict)", () => {
  const v = validateQuoteInput({
    productId: "p1",
    price: 1000,
    currency: "EUR",
    inclusions: { frontpage: true, contactEmail: "sales@example.com" },
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "quote.invalid_inclusions");
});
