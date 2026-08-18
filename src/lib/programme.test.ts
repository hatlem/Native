import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recommendCadence,
  planWaveDates,
  shiftScheduleStart,
  anglesFor,
  clampCadence,
  WAVE_OPTIONS,
  SPACING_OPTIONS,
} from "./programme";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

test("recommendCadence: default is 3 waves, 6 weeks, problem→proof→howto", () => {
  const c = recommendCadence({ goal: null, bookingUnits: [] });
  assert.equal(c.waves, 3);
  assert.equal(c.spacingWeeks, 6);
  assert.equal(c.rationaleKey, "default");
  assert.deepEqual(c.angles, ["problem", "proof", "howto"]);
});

test("recommendCadence: any monthly title widens spacing to 8 weeks", () => {
  const c = recommendCadence({ goal: null, bookingUnits: ["WEEK", "MONTH"] });
  assert.equal(c.spacingWeeks, 8);
  assert.equal(c.rationaleKey, "monthlyCycle");
});

test("recommendCadence: all-weekly titles tighten to 4 weeks", () => {
  const c = recommendCadence({ goal: null, bookingUnits: ["WEEK", "WEEK"] });
  assert.equal(c.spacingWeeks, 4);
  assert.equal(c.rationaleKey, "weeklyCycle");
});

test("recommendCadence: launch goal → 4 waves, tighter, in any supported language", () => {
  for (const goal of ["Product launch Q4", "Lansering av ny modell", "Produktlansierung", "Lanseeraus"]) {
    const c = recommendCadence({ goal, bookingUnits: ["MONTH"] });
    assert.equal(c.waves, 4, goal);
    assert.equal(c.spacingWeeks, 4, goal);
    assert.equal(c.rationaleKey, "launch", goal);
    assert.equal(c.angles.length, 4);
  }
});

test("recommendCadence: awareness goal → +2 weeks spacing", () => {
  const c = recommendCadence({ goal: "Bygge kjennskap i transportbransjen", bookingUnits: ["WEEK"] });
  assert.equal(c.spacingWeeks, 6);
  assert.equal(c.rationaleKey, "awareness");
});

test("anglesFor: cycles the sequence to the requested length", () => {
  const c = recommendCadence({ goal: null, bookingUnits: [] });
  assert.deepEqual(anglesFor(2, c), ["problem", "proof"]);
  assert.deepEqual(anglesFor(4, c), ["problem", "proof", "howto", "comparison"]);
});

test("clampCadence: coerces to the offered options", () => {
  assert.deepEqual(clampCadence(3, 6), { waves: 3, spacingWeeks: 6 });
  assert.deepEqual(clampCadence(1, 6), { waves: WAVE_OPTIONS[0], spacingWeeks: 6 });
  assert.deepEqual(clampCadence(9, 6), { waves: WAVE_OPTIONS[WAVE_OPTIONS.length - 1], spacingWeeks: 6 });
  assert.deepEqual(clampCadence(3, 5), { waves: 3, spacingWeeks: 6 }); // nearest
  assert.deepEqual(clampCadence(NaN, NaN), { waves: 3, spacingWeeks: 6 });
  assert.equal(clampCadence(3, 100).spacingWeeks, SPACING_OPTIONS[SPACING_OPTIONS.length - 1]);
});

test("shiftScheduleStart: WEEK keeps the Monday anchor", () => {
  const d = shiftScheduleStart(new Date("2026-08-31T00:00:00Z"), 6, "WEEK");
  assert.equal(iso(d), "2026-10-12");
});

test("shiftScheduleStart: MONTH snaps to first-of-month, rounding weeks to months", () => {
  assert.equal(iso(shiftScheduleStart(new Date("2026-09-01T00:00:00Z"), 6, "MONTH")), "2026-10-01");
  assert.equal(iso(shiftScheduleStart(new Date("2026-09-01T00:00:00Z"), 8, "MONTH")), "2026-11-01");
  assert.equal(iso(shiftScheduleStart(new Date("2026-09-01T00:00:00Z"), 2, "MONTH")), "2026-10-01"); // never zero
});

test("planWaveDates: from an explicit first start", () => {
  const dates = planWaveDates(new Date("2026-09-01T00:00:00Z"), 3, 8, "MONTH", new Date("2026-08-18T00:00:00Z"));
  assert.deepEqual(dates.map(iso), ["2026-09-01", "2026-11-01", "2027-01-01"]);
});

test("planWaveDates: no first start → next period from base", () => {
  const dates = planWaveDates(null, 2, 4, "WEEK", new Date("2026-08-18T00:00:00Z")); // Tue → Mon 17 Aug
  assert.deepEqual(dates.map(iso), ["2026-08-17", "2026-09-14"]);
});
