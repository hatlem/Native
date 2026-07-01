import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEstimate, type EstimateLine } from "./campaign-estimate";

const line = (over: Partial<EstimateLine>): EstimateLine => ({
  currency: "NOK",
  lineTotal: 1000,
  priceVisible: true,
  titleId: "t1",
  reach: 100,
  ...over,
});

test("computeEstimate: empty → zeroed", () => {
  const e = computeEstimate([]);
  assert.deepEqual(e.totals, []);
  assert.equal(e.reach, 0);
  assert.equal(e.itemCount, 0);
});

test("computeEstimate: sums visible amounts per currency", () => {
  const e = computeEstimate([
    line({ currency: "NOK", lineTotal: 1000, titleId: "a" }),
    line({ currency: "NOK", lineTotal: 500, titleId: "b" }),
  ]);
  assert.equal(e.totals.length, 1);
  assert.equal(e.totals[0].amount, 1500);
  assert.equal(e.totals[0].hasVisible, true);
  assert.equal(e.totals[0].hasHidden, false);
});

test("computeEstimate: hidden-price line registers currency but not amount", () => {
  const e = computeEstimate([
    line({ currency: "SEK", lineTotal: 0, priceVisible: false, titleId: "a" }),
  ]);
  assert.equal(e.totals[0].amount, 0);
  assert.equal(e.totals[0].hasVisible, false);
  assert.equal(e.totals[0].hasHidden, true);
});

test("computeEstimate: visible currencies sort before hidden-only", () => {
  const e = computeEstimate([
    line({ currency: "DKK", priceVisible: false, lineTotal: 0, titleId: "a" }),
    line({ currency: "NOK", priceVisible: true, lineTotal: 200, titleId: "b" }),
  ]);
  assert.equal(e.totals[0].currency, "NOK");
  assert.equal(e.totals[1].currency, "DKK");
});

test("computeEstimate: reach counts each title once (max), not per placement", () => {
  const e = computeEstimate([
    line({ titleId: "a", reach: 500 }),
    line({ titleId: "a", reach: 300 }),
    line({ titleId: "b", reach: 200 }),
  ]);
  assert.equal(e.reach, 700); // 500 (title a) + 200 (title b)
  assert.equal(e.itemCount, 3);
});
