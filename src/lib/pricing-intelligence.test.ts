import { test } from "node:test";
import assert from "node:assert/strict";
import {
  benchmarkBy,
  suggestMargin,
  median,
  type BenchmarkRow,
  type MarginObservation,
} from "./pricing-intelligence";

test("benchmarkBy aggregates samples, win rate, avg margin and value", () => {
  const rows: BenchmarkRow[] = [
    { key: "business", marginPct: 20, lineTotal: 1000, won: true },
    { key: "business", marginPct: 10, lineTotal: 3000, won: false },
    { key: "business", marginPct: 30, lineTotal: 2000, won: true },
    { key: "lifestyle", marginPct: 15, lineTotal: 500, won: false },
  ];
  const b = benchmarkBy(rows);
  // business first (more samples)
  assert.equal(b[0].key, "business");
  assert.equal(b[0].samples, 3);
  assert.equal(b[0].avgMarginPct, 20); // (20+10+30)/3
  assert.equal(b[0].winRatePct, 66.7); // 2/3
  assert.equal(b[0].avgLineTotal, 2000); // (1000+3000+2000)/3
  assert.equal(b[1].key, "lifestyle");
  assert.equal(b[1].winRatePct, 0);
});

test("suggestMargin picks the highest margin tier that still wins", () => {
  // 6 obs: margin 10 always wins; margin 25 wins 2/3; margin 40 loses.
  const obs: MarginObservation[] = [
    { marginPct: 10, won: true },
    { marginPct: 10, won: true },
    { marginPct: 25, won: true },
    { marginPct: 25, won: true },
    { marginPct: 25, won: false },
    { marginPct: 40, won: false },
  ];
  const s = suggestMargin(obs, 15);
  assert.equal(s.basis, "win-rate");
  assert.equal(s.marginPct, 25); // 25 clears 0.5 (2/3); 40 does not
  assert.equal(s.sampleSize, 6);
});

test("suggestMargin falls back to category median when data is thin", () => {
  const s = suggestMargin([{ marginPct: 30, won: true }], 18);
  assert.equal(s.basis, "category-median");
  assert.equal(s.marginPct, 18);
});

test("suggestMargin falls back to default when no median and thin data", () => {
  const s = suggestMargin([], null);
  assert.equal(s.basis, "default");
  assert.equal(s.marginPct, 15); // DEFAULT_MARGIN_PCT
});

test("suggestMargin falls back when no tier clears the threshold", () => {
  // Enough samples, but everything loses → can't justify any tier.
  const obs: MarginObservation[] = Array.from({ length: 6 }, () => ({
    marginPct: 30,
    won: false,
  }));
  const s = suggestMargin(obs, 12);
  assert.equal(s.basis, "category-median");
  assert.equal(s.marginPct, 12);
});

test("suggestMargin respects custom threshold and minSamples", () => {
  const obs: MarginObservation[] = [
    { marginPct: 20, won: true },
    { marginPct: 20, won: false },
  ];
  // minSamples 2 so we evaluate; threshold 0.4 → 20 wins (0.5 >= 0.4)
  const s = suggestMargin(obs, 10, { minSamples: 2, winRateThreshold: 0.4 });
  assert.equal(s.basis, "win-rate");
  assert.equal(s.marginPct, 20);
});

test("median handles odd, even and empty", () => {
  assert.equal(median([5]), 5);
  assert.equal(median([10, 20, 30]), 20);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), null);
});
