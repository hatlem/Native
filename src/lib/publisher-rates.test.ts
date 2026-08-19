import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidBasePrice,
  parseBasePrice,
  MAX_BASE_PRICE,
} from "./publisher-rates";

test("isValidBasePrice: accepts positive prices up to the cap", () => {
  assert.equal(isValidBasePrice(1), true);
  assert.equal(isValidBasePrice(45000), true);
  assert.equal(isValidBasePrice(12500.5), true);
  assert.equal(isValidBasePrice(MAX_BASE_PRICE), true);
});

test("isValidBasePrice: rejects zero, negatives, and the fat-finger zone", () => {
  assert.equal(isValidBasePrice(0), false);
  assert.equal(isValidBasePrice(-1), false);
  assert.equal(isValidBasePrice(MAX_BASE_PRICE + 1), false);
});

test("isValidBasePrice: rejects non-finite and non-number input", () => {
  assert.equal(isValidBasePrice(NaN), false);
  assert.equal(isValidBasePrice(Infinity), false);
  assert.equal(isValidBasePrice("45000"), false);
  assert.equal(isValidBasePrice(null), false);
  assert.equal(isValidBasePrice(undefined), false);
});

test("parseBasePrice: parses plain and formatted numeric strings", () => {
  assert.equal(parseBasePrice("45000"), 45000);
  assert.equal(parseBasePrice("12 500"), 12500);
  assert.equal(parseBasePrice("12500.50"), 12500.5);
  // Decimal comma (the no/da/sv/fi/de keyboards' default)
  assert.equal(parseBasePrice("12500,50"), 12500.5);
});

test("parseBasePrice: rejects empty, zero, garbage and out-of-range", () => {
  assert.equal(parseBasePrice(""), null);
  assert.equal(parseBasePrice("   "), null);
  assert.equal(parseBasePrice("0"), null);
  assert.equal(parseBasePrice("-100"), null);
  assert.equal(parseBasePrice("abc"), null);
  assert.equal(parseBasePrice("10000001"), null);
});
