import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleOverlapWarnings, type WaveScheduleItem } from "./programme-warnings";

function item(overrides: Partial<WaveScheduleItem>): WaveScheduleItem {
  return {
    titleId: "title-1",
    titleName: "Anlegg & Transport",
    scheduleStart: null,
    scheduleUnits: 1,
    bookingUnit: "WEEK",
    ...overrides,
  };
}

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

test("same title in two waves with overlapping runs is flagged once", () => {
  const warnings = scheduleOverlapWarnings([
    // 4 weeks from 1 Sep → ends 29 Sep (exclusive)
    { waveNumber: 1, items: [item({ scheduleStart: d("2026-09-01"), scheduleUnits: 4 })] },
    // starts 15 Sep, inside wave 1's run
    { waveNumber: 2, items: [item({ scheduleStart: d("2026-09-15"), scheduleUnits: 2 })] },
  ]);
  assert.deepEqual(warnings, [
    { titleName: "Anlegg & Transport", waveA: 1, waveB: 2 },
  ]);
});

test("runs that touch at the exclusive boundary do not overlap", () => {
  const warnings = scheduleOverlapWarnings([
    // 1 week from Mon 7 Sep → exclusive end Mon 14 Sep
    { waveNumber: 1, items: [item({ scheduleStart: d("2026-09-07"), scheduleUnits: 1 })] },
    // starts exactly at wave 1's exclusive end — back-to-back, not simultaneous
    { waveNumber: 2, items: [item({ scheduleStart: d("2026-09-14"), scheduleUnits: 1 })] },
  ]);
  assert.deepEqual(warnings, []);
});

test("MONTH grid: a 2-month run colliding with the next wave's month", () => {
  const warnings = scheduleOverlapWarnings([
    // Sep + Oct → exclusive end 1 Nov
    {
      waveNumber: 1,
      items: [item({ scheduleStart: d("2026-09-01"), scheduleUnits: 2, bookingUnit: "MONTH" })],
    },
    // October run — inside wave 1's window
    {
      waveNumber: 2,
      items: [item({ scheduleStart: d("2026-10-01"), scheduleUnits: 1, bookingUnit: "MONTH" })],
    },
  ]);
  assert.equal(warnings.length, 1);
});

test("null scheduleStart never overlaps anything", () => {
  const warnings = scheduleOverlapWarnings([
    { waveNumber: 1, items: [item({ scheduleStart: null })] },
    { waveNumber: 2, items: [item({ scheduleStart: d("2026-09-01"), scheduleUnits: 8 })] },
    { waveNumber: 3, items: [item({ scheduleStart: null })] },
  ]);
  assert.deepEqual(warnings, []);
});

test("null scheduleUnits counts as one period", () => {
  const warnings = scheduleOverlapWarnings([
    // 1 week from 7 Sep → ends 14 Sep; the 10 Sep start in wave 2 is inside it
    { waveNumber: 1, items: [item({ scheduleStart: d("2026-09-07"), scheduleUnits: null })] },
    { waveNumber: 2, items: [item({ scheduleStart: d("2026-09-10"), scheduleUnits: null })] },
  ]);
  assert.equal(warnings.length, 1);
});

test("two overlapping lines on the same title in the SAME wave are ignored", () => {
  const warnings = scheduleOverlapWarnings([
    {
      waveNumber: 1,
      items: [
        item({ scheduleStart: d("2026-09-07"), scheduleUnits: 4 }),
        item({ scheduleStart: d("2026-09-14"), scheduleUnits: 4 }),
      ],
    },
  ]);
  assert.deepEqual(warnings, []);
});

test("different titles running simultaneously never warn", () => {
  const warnings = scheduleOverlapWarnings([
    { waveNumber: 1, items: [item({ titleId: "a", scheduleStart: d("2026-09-07") })] },
    { waveNumber: 2, items: [item({ titleId: "b", scheduleStart: d("2026-09-07") })] },
  ]);
  assert.deepEqual(warnings, []);
});

test("items without a titleId are skipped", () => {
  const warnings = scheduleOverlapWarnings([
    { waveNumber: 1, items: [item({ titleId: null, scheduleStart: d("2026-09-07") })] },
    { waveNumber: 2, items: [item({ titleId: null, scheduleStart: d("2026-09-07") })] },
  ]);
  assert.deepEqual(warnings, []);
});

test("dedupes per title + wave pair even with multiple colliding lines", () => {
  const warnings = scheduleOverlapWarnings([
    {
      waveNumber: 2,
      items: [
        item({ scheduleStart: d("2026-09-07"), scheduleUnits: 4 }),
        item({ scheduleStart: d("2026-09-14"), scheduleUnits: 4 }),
      ],
    },
    {
      waveNumber: 3,
      items: [item({ scheduleStart: d("2026-09-14"), scheduleUnits: 4 })],
    },
  ]);
  // Both wave-2 lines collide with the wave-3 line — one warning, waveA < waveB.
  assert.deepEqual(warnings, [
    { titleName: "Anlegg & Transport", waveA: 2, waveB: 3 },
  ]);
});
