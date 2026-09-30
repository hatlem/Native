import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recommendCadence,
  planWaveDates,
  shiftScheduleStart,
  anglesFor,
  clampCadence,
  nextPeriodStart,
  waveOneStart,
  stripWaveSuffix,
  dueWaveFromView,
  WAVE_OPTIONS,
  SPACING_OPTIONS,
  type ProgrammeView,
  type WaveState,
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

test("planWaveDates: no first start → the NEXT period from base, never the current one", () => {
  // Tue 18 Aug: this week began Mon 17 Aug (past), so wave 1 is Mon 24 Aug.
  const dates = planWaveDates(null, 2, 4, "WEEK", new Date("2026-08-18T00:00:00Z"));
  assert.deepEqual(dates.map(iso), ["2026-08-24", "2026-09-21"]);
});

test("planWaveDates: 30 Sep, monthly, 4 weeks apart → 1 Oct, 1 Nov, 1 Dec (the E2E repro)", () => {
  // Before: wave 1 anchored at 1 Sep (already started) and wave 2 on 1 Oct —
  // "due tomorrow" the moment the programme existed.
  const dates = planWaveDates(null, 3, 4, "MONTH", new Date("2026-09-30T10:00:00Z"));
  assert.deepEqual(dates.map(iso), ["2026-10-01", "2026-11-01", "2026-12-01"]);
});

test("planWaveDates: a first start already in the past is replaced by the next period", () => {
  const dates = planWaveDates(new Date("2026-09-01T00:00:00Z"), 2, 8, "MONTH", new Date("2026-09-30T00:00:00Z"));
  assert.deepEqual(dates.map(iso), ["2026-10-01", "2026-12-01"]);
});

test("nextPeriodStart: today when today is a period start, else the next one", () => {
  assert.equal(iso(nextPeriodStart("MONTH", new Date("2026-10-01T15:00:00Z"))), "2026-10-01");
  assert.equal(iso(nextPeriodStart("MONTH", new Date("2026-10-02T00:00:00Z"))), "2026-11-01");
  assert.equal(iso(nextPeriodStart("MONTH", new Date("2026-12-15T00:00:00Z"))), "2027-01-01");
  assert.equal(iso(nextPeriodStart("WEEK", new Date("2026-08-17T09:00:00Z"))), "2026-08-17"); // Monday
  assert.equal(iso(nextPeriodStart("WEEK", new Date("2026-08-23T09:00:00Z"))), "2026-08-24"); // Sunday
});

test("waveOneStart: keeps a future start, replaces a missing or past one", () => {
  const base = new Date("2026-09-30T00:00:00Z");
  assert.equal(iso(waveOneStart(new Date("2027-02-01T00:00:00Z"), "MONTH", base)), "2027-02-01");
  assert.equal(iso(waveOneStart(null, "MONTH", base)), "2026-10-01");
  assert.equal(iso(waveOneStart(new Date("2026-09-01T00:00:00Z"), "MONTH", base)), "2026-10-01");
});

test("stripWaveSuffix: recognises every UI language's wave word", () => {
  assert.equal(stripWaveSuffix("Spring · Wave 2"), "Spring");
  assert.equal(stripWaveSuffix("Vår · Runde 3"), "Vår");
  assert.equal(stripWaveSuffix("Vår · Omgång 1"), "Vår");
  assert.equal(stripWaveSuffix("Kevät · Kierros 4"), "Kevät");
  assert.equal(stripWaveSuffix("Frühling · Welle 2"), "Frühling");
  // Not a wave suffix: left alone.
  assert.equal(stripWaveSuffix("Q4 · Oslo 2"), "Q4 · Oslo 2");
  assert.equal(stripWaveSuffix("Plain plan"), "Plain plan");
});

// ---------- dueWaveFromView (pure due filter behind findDueWaves / auto-send) ----------

function fabricate(
  waves: Array<{ state: WaveState; scheduleStart?: Date | null }>,
): ProgrammeView {
  return {
    id: "prog-1",
    organizationId: "org-1",
    name: "Fabricated",
    plannedWaves: waves.length,
    spacingWeeks: 6,
    rationaleKey: null,
    waves: waves.map((w, i) => ({
      listId: `list-${i + 1}`,
      waveNumber: i + 1,
      name: `Wave ${i + 1}`,
      articleId: null,
      articleTitle: null,
      scheduleStart: w.scheduleStart ?? null,
      state: w.state,
      orderId: null,
      requestId: null,
    })),
  };
}

const NOW = new Date("2026-08-18T00:00:00Z");

test("dueWaveFromView: wave 1 is never due, even as a scheduled draft", () => {
  const v = fabricate([{ state: "draft", scheduleStart: NOW }]);
  assert.equal(dueWaveFromView(v, NOW), null);
});

test("dueWaveFromView: previous live/done wave makes the next draft due", () => {
  const live = dueWaveFromView(fabricate([{ state: "live" }, { state: "draft" }]), NOW);
  assert.equal(live?.reason, "previous-live");
  assert.equal(live?.waveNumber, 2);
  assert.equal(live?.organizationId, "org-1");
  const done = dueWaveFromView(fabricate([{ state: "done" }, { state: "draft" }]), NOW);
  assert.equal(done?.reason, "previous-done");
});

test("dueWaveFromView: date within the 21-day horizon fires date-near; beyond it doesn't", () => {
  const near = fabricate([{ state: "sent" }, { state: "draft", scheduleStart: new Date("2026-09-07T00:00:00Z") }]);
  assert.equal(dueWaveFromView(near, NOW)?.reason, "date-near");
  const far = fabricate([{ state: "sent" }, { state: "draft", scheduleStart: new Date("2026-09-09T00:00:00Z") }]);
  assert.equal(dueWaveFromView(far, NOW), null);
});

test("dueWaveFromView: at most one wave — the first eligible draft", () => {
  const v = fabricate([{ state: "done" }, { state: "draft" }, { state: "draft" }]);
  assert.equal(dueWaveFromView(v, NOW)?.waveNumber, 2);
});

test("dueWaveFromView: a dateless draft doesn't block a later scheduled draft", () => {
  // Wave 2 has no date and its predecessor is only sent — no reason. Wave 3
  // is scheduled inside the horizon, so IT gets the nudge (scan continues).
  const v = fabricate([
    { state: "sent" },
    { state: "draft" },
    { state: "draft", scheduleStart: new Date("2026-08-25T00:00:00Z") },
  ]);
  assert.equal(dueWaveFromView(v, NOW)?.waveNumber, 3);
});

test("dueWaveFromView: submitted waves are never re-sent (idempotency for auto-send)", () => {
  const v = fabricate([{ state: "done" }, { state: "sent" }]);
  assert.equal(dueWaveFromView(v, NOW), null);
});
