import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRunRange, runBounds } from "./run-period";

const OCT = new Date("2026-10-01T00:00:00Z");

test("runBounds: the last day is inclusive and a missing count is one period", () => {
  const two = runBounds(OCT, 2, "MONTH");
  assert.equal(two.last.toISOString().slice(0, 10), "2026-11-30");
  assert.equal(two.units, 2);
  const one = runBounds(OCT, null, "MONTH");
  assert.equal(one.last.toISOString().slice(0, 10), "2026-10-31");
  assert.equal(one.units, 1);
  const weeks = runBounds(new Date("2026-10-05T00:00:00Z"), 2, "WEEK");
  assert.equal(weeks.last.toISOString().slice(0, 10), "2026-10-18");
});

test("formatRunRange: month runs name the months, week runs the days", () => {
  const months = formatRunRange(OCT, 2, "MONTH", "en");
  assert.match(months, /Oct/);
  assert.match(months, /Nov/);
  assert.match(months, /2026/);
  // One month is one month, not a range to itself.
  assert.doesNotMatch(formatRunRange(OCT, 1, "MONTH", "en"), /Nov|–/);
  const weeks = formatRunRange(new Date("2026-10-05T00:00:00Z"), 2, "WEEK", "en");
  assert.match(weeks, /5/);
  assert.match(weeks, /18/);
  // Across a year boundary both years show.
  const dec = formatRunRange(new Date("2026-12-01T00:00:00Z"), 2, "MONTH", "no");
  assert.match(dec, /2026/);
  assert.match(dec, /2027/);
});
