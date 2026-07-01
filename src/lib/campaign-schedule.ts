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
