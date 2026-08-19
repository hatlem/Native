import { test } from "node:test";
import assert from "node:assert/strict";
import { monthsWindow, intersectsMonth, draftWindow, orderWindow } from "./campaign-timeline";

const now = new Date("2026-08-18T09:30:00Z");
const aug = () => monthsWindow(now, 1)[0];

test("monthsWindow: six consecutive months starting from the current month", () => {
  const m = monthsWindow(now, 6);
  assert.deepEqual(
    m.map((x) => x.key),
    ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"],
  );
  assert.equal(m[0].start.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(m[0].end.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(m[5].year, 2027);
  assert.equal(m[5].month, 1);
});

test("monthsWindow: zero count yields no months", () => {
  assert.deepEqual(monthsWindow(now, 0), []);
});

test("intersectsMonth: window spanning the whole month matches", () => {
  const w = { start: new Date("2026-07-15T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") };
  assert.ok(intersectsMonth(w, aug()));
});

test("intersectsMonth: window ending exactly at month start does not match (half-open)", () => {
  const w = { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-08-01T00:00:00Z") };
  assert.ok(!intersectsMonth(w, aug()));
});

test("intersectsMonth: window starting exactly at month end does not match (half-open)", () => {
  const w = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") };
  assert.ok(!intersectsMonth(w, aug()));
});

test("intersectsMonth: one-day window inside the month matches", () => {
  const w = { start: new Date("2026-08-18T00:00:00Z"), end: new Date("2026-08-19T00:00:00Z") };
  assert.ok(intersectsMonth(w, aug()));
});

test("intersectsMonth: degenerate window (end <= start) never matches", () => {
  const at = new Date("2026-08-18T00:00:00Z");
  assert.ok(!intersectsMonth({ start: at, end: at }, aug()));
  assert.ok(!intersectsMonth({ start: at, end: new Date("2026-08-01T00:00:00Z") }, aug()));
});

test("draftWindow: min start to max exclusive end across mixed booking units", () => {
  const w = draftWindow([
    { scheduleStart: new Date("2026-09-01T00:00:00Z"), scheduleUnits: 2, bookingUnit: "MONTH" },
    // 2026-08-31 is a Monday anchor; 1 week → exclusive end 2026-09-07.
    { scheduleStart: new Date("2026-08-31T00:00:00Z"), scheduleUnits: 1, bookingUnit: "WEEK" },
    { scheduleStart: null, scheduleUnits: null, bookingUnit: "MONTH" },
  ]);
  assert.equal(w?.start.toISOString(), "2026-08-31T00:00:00.000Z");
  assert.equal(w?.end.toISOString(), "2026-11-01T00:00:00.000Z");
});

test("draftWindow: null units default to one period", () => {
  const w = draftWindow([
    { scheduleStart: new Date("2026-10-01T00:00:00Z"), scheduleUnits: null, bookingUnit: "MONTH" },
  ]);
  assert.equal(w?.end.toISOString(), "2026-11-01T00:00:00.000Z");
});

test("draftWindow: nothing scheduled → null (Not scheduled yet bucket)", () => {
  assert.equal(draftWindow([{ scheduleStart: null, scheduleUnits: null, bookingUnit: "MONTH" }]), null);
  assert.equal(draftWindow([]), null);
});

test("orderWindow: inclusive flight dates become a half-open window", () => {
  const w = orderWindow(new Date("2026-08-10T00:00:00Z"), new Date("2026-08-10T00:00:00Z"));
  assert.equal(w?.start.toISOString(), "2026-08-10T00:00:00.000Z");
  // A one-day flight still occupies its day: exclusive end is the next day.
  assert.equal(w?.end.toISOString(), "2026-08-11T00:00:00.000Z");
  assert.ok(w && intersectsMonth(w, aug()));
});

test("orderWindow: flight ending on the last day of a month counts in that month only", () => {
  const w = orderWindow(new Date("2026-07-01T00:00:00Z"), new Date("2026-08-31T00:00:00Z"));
  assert.ok(w && intersectsMonth(w, aug()));
  const sep = monthsWindow(new Date("2026-09-15T00:00:00Z"), 1)[0];
  assert.ok(w && !intersectsMonth(w, sep));
});

test("orderWindow: a single known date is used for both ends", () => {
  const onlyStart = orderWindow(new Date("2026-08-10T00:00:00Z"), null);
  assert.equal(onlyStart?.end.toISOString(), "2026-08-11T00:00:00.000Z");
  const onlyEnd = orderWindow(null, new Date("2026-08-10T00:00:00Z"));
  assert.equal(onlyEnd?.start.toISOString(), "2026-08-10T00:00:00.000Z");
  assert.equal(onlyEnd?.end.toISOString(), "2026-08-11T00:00:00.000Z");
});

test("orderWindow: no dates at all → null", () => {
  assert.equal(orderWindow(null, null), null);
});
