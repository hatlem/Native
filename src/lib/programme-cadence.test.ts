import { test } from "node:test";
import assert from "node:assert/strict";
import { planWaveDates, recommendCadence, spacingInMonths } from "./programme-cadence";

test("spacingInMonths: week spacings round to whole months, at least one", () => {
  assert.equal(spacingInMonths(2), 1);
  assert.equal(spacingInMonths(4), 1);
  assert.equal(spacingInMonths(6), 1);
  assert.equal(spacingInMonths(8), 2);
  assert.equal(spacingInMonths(12), 3);
});

test("month-grid wave dates move by the months the form states", () => {
  const base = new Date("2026-09-30T00:00:00Z");
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  // "4 weeks apart" on monthly titles: one month apart, as the copy says.
  const four = planWaveDates(null, 3, 4, "MONTH", base).map(iso);
  assert.deepEqual(four, ["2026-10-01", "2026-11-01", "2026-12-01"]);
  const eight = planWaveDates(null, 3, 8, "MONTH", base).map(iso);
  assert.deepEqual(eight, ["2026-10-01", "2026-12-01", "2027-02-01"]);
});

test("recommendCadence: monthly titles get eight weeks, the number its rationale names", () => {
  const c = recommendCadence({ goal: null, bookingUnits: ["MONTH"] });
  assert.equal(c.rationaleKey, "monthlyCycle");
  assert.equal(c.spacingWeeks, 8);
  assert.equal(c.waves, 3);
});
