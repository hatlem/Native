// How a line's booked run reads: "Oct – Nov 2026" for months, "5 – 18 Oct
// 2026" for weeks. Pure (no clock, no DB); the caller wraps the range in the
// localized "{range} · {n} months" message (plan.runPeriod) so the length is
// never left for the reader to work out from a start date alone.

import { addPeriods, type BookingUnit } from "@/lib/campaign-schedule";
import { intlLocale } from "@/lib/money";

/** The run's first and LAST day (inclusive), from its period anchor. A start
 *  without a unit count is one period, the same rule as planWindowFromItems. */
export function runBounds(
  start: Date,
  units: number | null,
  unit: BookingUnit,
): { first: Date; last: Date; units: number } {
  const n = Math.max(1, Math.floor(units ?? 1));
  const endExclusive = addPeriods(start, n, unit);
  return { first: start, last: new Date(endExclusive.getTime() - 86_400_000), units: n };
}

/** The run as a localized date range. Month runs show months ("Oct – Nov
 *  2026"; one month reads "Oct 2026"), week runs show days. Always UTC:
 *  period anchors are UTC midnights, so any other zone shifts the day. */
export function formatRunRange(
  start: Date,
  units: number | null,
  unit: BookingUnit,
  locale: string,
): string {
  const { first, last } = runBounds(start, units, unit);
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
    ...(unit === "MONTH" ? { month: "short" } : { day: "numeric", month: "short" }),
    year: "numeric",
    timeZone: "UTC",
  });
  return fmt.formatRange(first, last);
}
