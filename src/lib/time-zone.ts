// The time zone a server-rendered clock time is shown in. Servers run in UTC
// (Railway), so an Intl formatter without `timeZone` printed "07:51" for a
// share link opened at 09:51 in Oslo. Wall-clock times follow the viewer's
// org market; without one, the UI language's main zone. Date-only values
// anchored at UTC midnight (schedules, validity days) keep formatting in UTC.

const MARKET_ZONE: Record<string, string> = {
  NO: "Europe/Oslo",
  SE: "Europe/Stockholm",
  DK: "Europe/Copenhagen",
  FI: "Europe/Helsinki",
  DE: "Europe/Berlin",
  AT: "Europe/Vienna",
  CH: "Europe/Zurich",
  UK: "Europe/London",
  IE: "Europe/Dublin",
  NL: "Europe/Amsterdam",
  BE: "Europe/Brussels",
};

const LOCALE_ZONE: Record<string, string> = {
  no: "Europe/Oslo",
  sv: "Europe/Stockholm",
  da: "Europe/Copenhagen",
  fi: "Europe/Helsinki",
  de: "Europe/Berlin",
  en: "Europe/London",
};

/** The IANA zone to show wall-clock times in for this viewer. */
export function displayTimeZone(input: { marketCode?: string | null; locale: string }): string {
  return (
    (input.marketCode && MARKET_ZONE[input.marketCode]) || LOCALE_ZONE[input.locale] || "Europe/London"
  );
}
