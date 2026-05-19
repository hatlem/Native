import { test } from "node:test";
import assert from "node:assert/strict";
import { indicativePrice, firmLineTotal, withVat, formatMoney } from "./money";

test("indicativePrice applies margin then seasonal multiplier", () => {
  assert.equal(indicativePrice(1000, 15), 1150);
  assert.equal(indicativePrice(1000, 15, 1.2), 1380);
  assert.equal(indicativePrice(1000, 0), 1000);
});

test("indicativePrice defaults seasonal multiplier to 1", () => {
  assert.equal(indicativePrice(2000, 25), indicativePrice(2000, 25, 1));
});

test("firmLineTotal multiplies the indicative unit price by quantity", () => {
  assert.equal(firmLineTotal(1000, 15, 3), 3450);
  assert.equal(firmLineTotal(1000, 15, 3, 2), 6900);
  assert.equal(firmLineTotal(500, 20, 1), indicativePrice(500, 20));
});

test("withVat adds the VAT percentage", () => {
  assert.equal(withVat(1000, 25), 1250);
  assert.equal(withVat(1000, 0), 1000);
  assert.equal(withVat(800, 12.5), 900);
});

test("formatMoney renders a zero-decimal currency string per locale", () => {
  const en = formatMoney(1234, "GBP", "en");
  assert.match(en, /1,234/);
  assert.ok(!en.includes("."), `expected no decimals, got ${en}`);
  // Unknown locale falls back to en-GB rather than throwing.
  assert.doesNotThrow(() => formatMoney(10, "EUR", "zz"));
});
