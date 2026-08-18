// Schedule-grid helpers for the campaign flow. Pure + DB-free so they unit-test
// without a clock — the caller passes the base date (a Server Component may use
// `new Date()`; tests pass a fixed instant).

export type BookingUnit = "WEEK" | "MONTH";

export type Period = { iso: string; year: number; month: number };

// The next `count` months as first-of-month UTC anchors, starting this month.
export function upcomingMonths(count: number, base: Date): Period[] {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const out: Period[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(y, m + i, 1));
    out.push({
      iso: d.toISOString().slice(0, 10),
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
    });
  }
  return out;
}

// The next `count` weeks as Monday UTC anchors, starting the current week.
export function upcomingWeeks(count: number, base: Date): Period[] {
  const day = base.getUTCDay(); // 0=Sun..6=Sat
  const toMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + toMonday),
  );
  const out: Period[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(monday.getTime() + i * 7 * 86_400_000);
    out.push({
      iso: d.toISOString().slice(0, 10),
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
    });
  }
  return out;
}

export function upcomingPeriods(unit: BookingUnit, count: number, base: Date): Period[] {
  return unit === "WEEK" ? upcomingWeeks(count, base) : upcomingMonths(count, base);
}

// Enforce the publisher's minimum run: never below max(1, min); floor to an int.
export function clampUnits(requested: number, min: number | null | undefined): number {
  const floor = Math.max(1, min ?? 1);
  const r = Math.floor(requested);
  return Number.isFinite(r) && r > floor ? r : floor;
}

// Exclusive end of a run of `units` booking periods starting at `start`
// (a period anchor: Monday / first-of-month, UTC). MONTH steps calendar
// months so a 1-unit run starting 1 Jan ends 1 Feb regardless of month length.
export function addPeriods(start: Date, units: number, unit: BookingUnit): Date {
  const n = Math.max(0, Math.floor(units));
  if (unit === "WEEK") return new Date(start.getTime() + n * 7 * 86_400_000);
  return new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, start.getUTCDate()),
  );
}

// The plan-level flight window implied by per-line schedules: earliest start
// to latest (exclusive) end. Lines without a start are ignored; a line with a
// start but no unit count is treated as one period. All-null → nulls, so the
// desk's manual flight window (saveFlightWindow) stays the only writer when
// the buyer never scheduled anything.
export function planWindowFromItems(
  items: Array<{
    scheduleStart: Date | null;
    scheduleUnits: number | null;
    bookingUnit: BookingUnit;
  }>,
): { start: Date | null; end: Date | null } {
  let start: Date | null = null;
  let end: Date | null = null;
  for (const it of items) {
    if (!it.scheduleStart) continue;
    const s = it.scheduleStart;
    const e = addPeriods(s, it.scheduleUnits ?? 1, it.bookingUnit);
    if (!start || s < start) start = s;
    if (!end || e > end) end = e;
  }
  return { start, end };
}
