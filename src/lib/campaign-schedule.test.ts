import { test } from "node:test";
import assert from "node:assert/strict";
import {
  upcomingMonths,
  upcomingWeeks,
  upcomingPeriods,
  startablePeriods,
  clampUnits,
  addPeriods,
  planWindowFromItems,
} from "./campaign-schedule";

const base = new Date("2026-07-01T12:00:00Z"); // a Wednesday

test("upcomingMonths: N first-of-month anchors from this month", () => {
  const m = upcomingMonths(3, base);
  assert.deepEqual(
    m.map((p) => p.iso),
    ["2026-07-01", "2026-08-01", "2026-09-01"],
  );
  assert.equal(m[1].year, 2026);
  assert.equal(m[1].month, 8);
});

test("upcomingMonths: rolls over year boundary", () => {
  const m = upcomingMonths(2, new Date("2026-12-10T00:00:00Z"));
  assert.deepEqual(m.map((p) => p.iso), ["2026-12-01", "2027-01-01"]);
});

test("upcomingWeeks: anchors on Mondays", () => {
  const w = upcomingWeeks(2, base); // week of 2026-06-29 (Mon)
  assert.deepEqual(w.map((p) => p.iso), ["2026-06-29", "2026-07-06"]);
});

test("upcomingWeeks: Sunday base uses the current (not next) Monday", () => {
  const w = upcomingWeeks(1, new Date("2026-07-05T00:00:00Z")); // Sunday
  assert.equal(w[0].iso, "2026-06-29");
});

test("upcomingPeriods: dispatches on unit", () => {
  assert.equal(upcomingPeriods("MONTH", 1, base)[0].iso, "2026-07-01");
  assert.equal(upcomingPeriods("WEEK", 1, base)[0].iso, "2026-06-29");
});

test("startablePeriods: drops the current period on its last day only", () => {
  // 30 September: September ends today, so October is the first start.
  const lastDay = startablePeriods("MONTH", 2, new Date("2026-09-30T15:00:00Z"));
  assert.deepEqual(lastDay.map((p) => p.iso), ["2026-10-01", "2026-11-01"]);
  // 29 September: a day remains, September is still offered.
  const dayBefore = startablePeriods("MONTH", 2, new Date("2026-09-29T15:00:00Z"));
  assert.deepEqual(dayBefore.map((p) => p.iso), ["2026-09-01", "2026-10-01"]);
  // Sunday ends the week; Saturday doesn't.
  assert.equal(startablePeriods("WEEK", 1, new Date("2026-07-05T10:00:00Z"))[0].iso, "2026-07-06");
  assert.equal(startablePeriods("WEEK", 1, new Date("2026-07-04T10:00:00Z"))[0].iso, "2026-06-29");
  // December's last day rolls into January.
  assert.equal(startablePeriods("MONTH", 1, new Date("2026-12-31T08:00:00Z"))[0].iso, "2027-01-01");
});

test("clampUnits: enforces minimum and integer floor", () => {
  assert.equal(clampUnits(1, 4), 4); // below min → min
  assert.equal(clampUnits(6, 4), 6); // above min kept
  assert.equal(clampUnits(2.9, null), 2); // floor, min defaults to 1
  assert.equal(clampUnits(0, null), 1); // never below 1
});

test("addPeriods: WEEK adds 7 days per unit, MONTH adds calendar months", () => {
  assert.equal(
    addPeriods(new Date("2026-06-29T00:00:00Z"), 2, "WEEK").toISOString().slice(0, 10),
    "2026-07-13",
  );
  assert.equal(
    addPeriods(new Date("2026-01-01T00:00:00Z"), 1, "MONTH").toISOString().slice(0, 10),
    "2026-02-01",
  );
  assert.equal(
    addPeriods(new Date("2026-11-01T00:00:00Z"), 3, "MONTH").toISOString().slice(0, 10),
    "2027-02-01",
  );
});

test("planWindowFromItems: nulls when nothing is scheduled", () => {
  assert.deepEqual(
    planWindowFromItems([{ scheduleStart: null, scheduleUnits: null, bookingUnit: "MONTH" }]),
    { start: null, end: null },
  );
  assert.deepEqual(planWindowFromItems([]), { start: null, end: null });
});

test("planWindowFromItems: earliest start, latest exclusive end across units", () => {
  const w = planWindowFromItems([
    { scheduleStart: new Date("2026-09-01T00:00:00Z"), scheduleUnits: 1, bookingUnit: "MONTH" },
    { scheduleStart: new Date("2026-08-31T00:00:00Z"), scheduleUnits: 2, bookingUnit: "WEEK" },
    { scheduleStart: null, scheduleUnits: 4, bookingUnit: "WEEK" }, // ignored: no start
  ]);
  assert.equal(w.start?.toISOString().slice(0, 10), "2026-08-31");
  assert.equal(w.end?.toISOString().slice(0, 10), "2026-10-01");
});
