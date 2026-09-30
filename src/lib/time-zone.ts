// Calendar-day arithmetic in a named IANA time zone, on the platform's Intl
// data (no tz library). Used where a date the user picked means a day on
// THEIR calendar: "valid until 21 Oct" in Oslo ends at 23:59 Oslo time, not
// at 23:59 UTC, which is already 01:59 on the 22nd there.

import { isSupportedMarket, marketTimeZone } from "@/lib/markets";

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// The zone's offset from UTC at `instant`, in ms (Oslo in summer: +2h).
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** True when the runtime knows `timeZone` (an IANA name like "Europe/Oslo"). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The last millisecond of calendar day y-m-d (month 1-12) in `timeZone`.
 * The offset is re-read at the candidate instant, so a day on which the
 * clocks change still ends at local 23:59:59.999 (European transitions
 * happen in the small hours, never near midnight).
 */
export function zonedEndOfDay(year: number, month: number, day: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const guess = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(guess), timeZone));
}

/** The calendar date of `instant` in `timeZone`, as YYYY-MM-DD. */
export function zonedDateString(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// Wall-clock times on server-rendered pages ("Sist åpnet 09:51"). Servers run
// in UTC (Railway), so a formatter without `timeZone` printed 07:51 for 09:51
// in Oslo. Follow the viewer's org market; without one, the UI language's
// main zone. Date-only values anchored at UTC midnight keep formatting in UTC.
const LOCALE_TIME_ZONES: Record<string, string> = {
  no: "Europe/Oslo",
  sv: "Europe/Stockholm",
  da: "Europe/Copenhagen",
  fi: "Europe/Helsinki",
  de: "Europe/Berlin",
  en: "Europe/London",
};

/** The IANA zone to show wall-clock times in for this viewer. */
export function displayTimeZone(input: { marketCode?: string | null; locale: string }): string {
  if (isSupportedMarket(input.marketCode)) return marketTimeZone(input.marketCode);
  return LOCALE_TIME_ZONES[input.locale] ?? "Europe/London";
}
