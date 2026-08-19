// Soft frequency-cap warnings for a programme's wave strip. Repetition ACROSS
// waves is the whole point of a programme — the waste is the same title
// running in two waves AT THE SAME TIME (the reader sees one campaign, the
// buyer pays for two placements). Pure + DB-free: the caller loads the wave
// items, this module only does interval maths on the schedule grid.

import { addPeriods, type BookingUnit } from "@/lib/campaign-schedule";

export type WaveScheduleItem = {
  titleId: string | null;
  titleName: string;
  scheduleStart: Date | null;
  scheduleUnits: number | null;
  bookingUnit: BookingUnit;
};

export type ScheduleOverlapWarning = {
  titleName: string;
  waveA: number;
  waveB: number;
};

/**
 * Flag every title that runs in two DIFFERENT waves with overlapping date
 * ranges. A run is [scheduleStart, addPeriods(start, units ?? 1, unit)) —
 * exclusive end, so back-to-back runs (wave 2 starting the day wave 1 ends)
 * never warn. Items without a start date can't overlap anything. One warning
 * per title + wave pair regardless of how many lines collide, waveA < waveB.
 */
export function scheduleOverlapWarnings(
  waves: Array<{ waveNumber: number; items: WaveScheduleItem[] }>,
): ScheduleOverlapWarning[] {
  type Run = { wave: number; titleName: string; start: Date; end: Date };
  const runsByTitle = new Map<string, Run[]>();
  for (const wave of waves) {
    for (const item of wave.items) {
      if (!item.titleId || !item.scheduleStart) continue;
      const runs = runsByTitle.get(item.titleId) ?? [];
      runs.push({
        wave: wave.waveNumber,
        titleName: item.titleName,
        start: item.scheduleStart,
        end: addPeriods(item.scheduleStart, item.scheduleUnits ?? 1, item.bookingUnit),
      });
      runsByTitle.set(item.titleId, runs);
    }
  }

  const out: ScheduleOverlapWarning[] = [];
  const seen = new Set<string>();
  for (const [titleId, runs] of runsByTitle) {
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i];
        const b = runs[j];
        // Two lines on the same title in the SAME wave is a quantity
        // decision, not a pacing mistake — only cross-wave collisions warn.
        if (a.wave === b.wave) continue;
        // Half-open intervals overlap iff each starts before the other ends.
        if (!(a.start < b.end && b.start < a.end)) continue;
        const [waveA, waveB] = a.wave < b.wave ? [a.wave, b.wave] : [b.wave, a.wave];
        const key = `${titleId}|${waveA}|${waveB}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ titleName: a.titleName, waveA, waveB });
      }
    }
  }
  // Deterministic render order: earliest colliding pair first, then by title.
  return out.sort(
    (x, y) =>
      x.waveA - y.waveA || x.waveB - y.waveB || x.titleName.localeCompare(y.titleName),
  );
}
