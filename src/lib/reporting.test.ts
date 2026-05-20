import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tally,
  sumByGroup,
  averageOrderValue,
  conversionPct,
} from "./reporting";

test("tally counts labels, highest first, ties broken by key", () => {
  assert.deepEqual(tally(["LIVE", "LIVE", "QUOTED", "LIVE", "QUOTED"]), [
    { key: "LIVE", count: 3 },
    { key: "QUOTED", count: 2 },
  ]);
  assert.deepEqual(tally(["b", "a"]), [
    { key: "a", count: 1 },
    { key: "b", count: 1 },
  ]);
  assert.deepEqual(tally([]), []);
});

test("sumByGroup totals per group, largest first", () => {
  const rows = [
    { group: "news", amount: 1000 },
    { group: "business", amount: 500 },
    { group: "news", amount: 250 },
  ];
  assert.deepEqual(sumByGroup(rows), [
    { group: "news", amount: 1250 },
    { group: "business", amount: 500 },
  ]);
  assert.deepEqual(sumByGroup([]), []);
});

test("averageOrderValue rounds and guards divide-by-zero", () => {
  assert.equal(averageOrderValue(3000, 2), 1500);
  assert.equal(averageOrderValue(1000, 3), 333);
  assert.equal(averageOrderValue(0, 0), 0);
});

test("conversionPct is a one-decimal percentage, zero-safe", () => {
  assert.equal(conversionPct(10, 5), 50);
  assert.equal(conversionPct(3, 1), 33.3);
  assert.equal(conversionPct(0, 0), 0);
  assert.equal(conversionPct(4, 4), 100);
});
