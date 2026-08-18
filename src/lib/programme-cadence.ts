// Cadence recommendation + wave-date math for campaign programmes. Pure and
// DB-free so it can run in client components (the /plan programme form
// previews wave dates as the buyer changes waves/spacing) and unit-test
// without a clock. The rules are the single source of truth for what we
// recommend — documented for humans in docs/campaign-cadence.md; keep both
// in sync. Deterministic on purpose: the rationale shown to the buyer is an
// i18n key, never model prose.

import { upcomingPeriods, type BookingUnit } from "@/lib/campaign-schedule";

// ---------- pure: cadence recommendation ----------

export type AngleKey = "problem" | "proof" | "howto" | "comparison";
export const ANGLE_KEYS: readonly AngleKey[] = ["problem", "proof", "howto", "comparison"];

export type RationaleKey = "default" | "monthlyCycle" | "weeklyCycle" | "launch" | "awareness";

export type CadencePlan = {
  waves: number;
  spacingWeeks: number;
  rationaleKey: RationaleKey;
  angles: AngleKey[];
};

export const WAVE_OPTIONS = [2, 3, 4] as const;
export const SPACING_OPTIONS = [2, 4, 6, 8, 12] as const;

const DEFAULT_WAVES = 3;
const DEFAULT_SPACING = 6;

// Goal phrasing that signals a launch / awareness intent across the six UI
// languages. Substring match on the lower-cased goal — good enough for a
// default; the buyer can always override the numbers.
const LAUNCH_HINTS = ["launch", "lanser", "lansier", "lanseer", "einführung", "introduc"];
const AWARENESS_HINTS = ["awareness", "kjennskap", "kännedom", "kendskab", "tunnettuu", "bekanntheit", "brand", "merkevare", "varumärke"];

function hasHint(goal: string | null, hints: string[]): boolean {
  if (!goal) return false;
  const g = goal.toLowerCase();
  return hints.some((h) => g.includes(h));
}

/**
 * Recommend a wave count + spacing + angle sequence for a plan.
 *
 * Rules (see docs/campaign-cadence.md):
 *  - default: 3 waves, 6 weeks apart, angles problem → proof → how-to
 *  - any MONTH-unit title: 8 weeks (two issues of a monthly) — "monthlyCycle"
 *  - all WEEK-unit titles: 4 weeks — "weeklyCycle"
 *  - launch goal: 4 waves, spacing capped at 4 weeks — "launch"
 *  - awareness/brand goal: spacing +2 weeks — "awareness"
 * Launch beats awareness when both match (a launch has a date; awareness doesn't).
 */
export function recommendCadence(input: { goal: string | null; bookingUnits: BookingUnit[] }): CadencePlan {
  let waves = DEFAULT_WAVES;
  let spacingWeeks = DEFAULT_SPACING;
  let rationaleKey: RationaleKey = "default";

  const units = input.bookingUnits;
  if (units.some((u) => u === "MONTH")) {
    spacingWeeks = 8;
    rationaleKey = "monthlyCycle";
  } else if (units.length > 0 && units.every((u) => u === "WEEK")) {
    spacingWeeks = 4;
    rationaleKey = "weeklyCycle";
  }

  if (hasHint(input.goal, LAUNCH_HINTS)) {
    waves = 4;
    spacingWeeks = Math.min(spacingWeeks, 4);
    rationaleKey = "launch";
  } else if (hasHint(input.goal, AWARENESS_HINTS)) {
    spacingWeeks += 2;
    rationaleKey = "awareness";
  }

  const clamped = clampCadence(waves, spacingWeeks);
  const base: CadencePlan = { ...clamped, rationaleKey, angles: [] };
  return { ...base, angles: anglesFor(clamped.waves, base) };
}

/** The angle sequence for `waves` waves — cycles ANGLE_KEYS so wave 4 gets "comparison". */
export function anglesFor(waves: number, _cadence: CadencePlan): AngleKey[] {
  return Array.from({ length: waves }, (_, i) => ANGLE_KEYS[i % ANGLE_KEYS.length]);
}

/** Coerce posted numbers onto the offered options (nearest), defaults on garbage. */
export function clampCadence(waves: number, spacingWeeks: number): { waves: number; spacingWeeks: number } {
  const nearest = (v: number, opts: readonly number[], fallback: number) => {
    if (!Number.isFinite(v)) return fallback;
    // Ties round up: more spacing is the safer default against wear-out.
    return opts.reduce((best, o) => (Math.abs(o - v) <= Math.abs(best - v) ? o : best), opts[0]);
  };
  return {
    waves: nearest(waves, WAVE_OPTIONS, DEFAULT_WAVES),
    spacingWeeks: nearest(spacingWeeks, SPACING_OPTIONS, DEFAULT_SPACING),
  };
}

// ---------- pure: wave dates ----------

/** Shift a period anchor by `weeks`, staying on the unit's grid. MONTH rounds
 *  weeks to whole months (min 1) and re-snaps to the 1st. */
export function shiftScheduleStart(start: Date, weeks: number, unit: BookingUnit): Date {
  if (unit === "WEEK") return new Date(start.getTime() + weeks * 7 * 86_400_000);
  const months = Math.max(1, Math.round(weeks / 4.33));
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
}

/** Anchor dates for each wave. Wave 1 = firstStart, or the current period
 *  when the source list has no schedule yet. */
export function planWaveDates(
  firstStart: Date | null,
  waves: number,
  spacingWeeks: number,
  unit: BookingUnit,
  base: Date,
): Array<Date | null> {
  const first = firstStart ?? new Date(`${upcomingPeriods(unit, 1, base)[0].iso}T00:00:00Z`);
  return Array.from({ length: waves }, (_, i) =>
    i === 0 ? first : shiftScheduleStart(first, spacingWeeks * i, unit),
  );
}
