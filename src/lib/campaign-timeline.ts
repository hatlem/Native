// Month-bucketing helpers for the requests Timeline view ("when does
// everything run?"). Pure + DB-free like campaign-schedule.ts: the caller
// passes `now` (a Server Component uses `new Date()`; tests pass a fixed
// instant), so nothing here touches a clock or the database.

import { planWindowFromItems, type BookingUnit } from "./campaign-schedule";

/** A calendar month as a half-open UTC interval [start, end). */
export type TimelineMonth = {
  /** "YYYY-MM" — stable list key and cheap equality handle. */
  key: string;
  year: number;
  /** 1–12 */
  month: number;
  /** First of the month, UTC midnight. */
  start: Date;
  /** First of the NEXT month, UTC midnight (exclusive). */
  end: Date;
};

/** A campaign's run window as a half-open UTC interval [start, end). */
export type RunWindow = { start: Date; end: Date };

const DAY_MS = 86_400_000;

/** The `count` calendar months starting with the month `now` falls in. */
export function monthsWindow(now: Date, count: number): TimelineMonth[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const out: TimelineMonth[] = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(Date.UTC(y, m + i, 1));
    out.push({
      key: start.toISOString().slice(0, 7),
      year: start.getUTCFullYear(),
      month: start.getUTCMonth() + 1,
      start,
      end: new Date(Date.UTC(y, m + i + 1, 1)),
    });
  }
  return out;
}

/**
 * Does a run window overlap a calendar month? Both intervals are half-open,
 * so a window ending exactly on the 1st belongs to the previous month only —
 * no campaign gets double-counted at a month boundary. Degenerate windows
 * (end <= start, e.g. from inconsistent flight dates) never match: nothing
 * "runs" for zero days.
 */
export function intersectsMonth(range: RunWindow, month: TimelineMonth): boolean {
  return range.end > range.start && range.start < month.end && range.end > month.start;
}

/**
 * A draft list's implied run window: earliest line start to the latest
 * exclusive line end (start + units×bookingUnit, defaulting to one period —
 * the same fold checkout uses for Plan.startDate/endDate). Null when no line
 * carries a date, which the timeline shows as "Not scheduled yet" instead of
 * guessing a month.
 */
export function draftWindow(
  items: Array<{
    scheduleStart: Date | null;
    scheduleUnits: number | null;
    bookingUnit: BookingUnit;
  }>,
): RunWindow | null {
  const { start, end } = planWindowFromItems(items);
  return start && end ? { start, end } : null;
}

/**
 * An order's run window from its flight dates. Flight dates are INCLUSIVE
 * calendar days (a flight ending 31 Aug runs through 31 Aug), so the
 * exclusive end is the day after the last flight day. When only one date is
 * known it stands in for both ends — a one-day window keeps the order
 * visible in the month we do know about rather than dropping it entirely.
 * Null when the desk hasn't set any flight dates yet.
 */
export function orderWindow(
  flightStartDate: Date | null,
  flightEndDate: Date | null,
): RunWindow | null {
  const start = flightStartDate ?? flightEndDate;
  if (!start) return null;
  const lastDay = flightEndDate ?? flightStartDate!;
  return { start, end: new Date(lastDay.getTime() + DAY_MS) };
}
