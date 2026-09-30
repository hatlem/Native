import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidTimeZone, zonedDateString, zonedEndOfDay } from "./time-zone";
import { MARKET_TIME_ZONES, SUPPORTED_MARKETS, marketTimeZone } from "./markets";

test("zonedEndOfDay is local 23:59:59.999, on summer and winter time", () => {
  assert.equal(zonedEndOfDay(2026, 10, 21, "Europe/Oslo").toISOString(), "2026-10-21T21:59:59.999Z");
  assert.equal(zonedEndOfDay(2026, 12, 21, "Europe/Oslo").toISOString(), "2026-12-21T22:59:59.999Z");
  assert.equal(zonedEndOfDay(2026, 12, 21, "Europe/London").toISOString(), "2026-12-21T23:59:59.999Z");
  assert.equal(zonedEndOfDay(2026, 7, 1, "Europe/Helsinki").toISOString(), "2026-07-01T20:59:59.999Z");
  // Both clock-change days end on the zone's new offset.
  assert.equal(zonedEndOfDay(2026, 3, 29, "Europe/Berlin").toISOString(), "2026-03-29T21:59:59.999Z");
  assert.equal(zonedEndOfDay(2026, 10, 25, "Europe/Berlin").toISOString(), "2026-10-25T22:59:59.999Z");
});

test("zonedDateString reads the calendar day in the zone, not in UTC", () => {
  const instant = new Date("2026-10-21T22:30:00Z");
  assert.equal(zonedDateString(instant, "UTC"), "2026-10-21");
  assert.equal(zonedDateString(instant, "Europe/Oslo"), "2026-10-22");
  assert.equal(zonedDateString(zonedEndOfDay(2026, 10, 21, "Europe/Oslo"), "Europe/Oslo"), "2026-10-21");
});

test("every served market has a zone the runtime knows; unknown orgs use the desk's", () => {
  for (const code of SUPPORTED_MARKETS) {
    assert.ok(isValidTimeZone(MARKET_TIME_ZONES[code]), code);
    assert.equal(marketTimeZone(code), MARKET_TIME_ZONES[code]);
  }
  assert.equal(marketTimeZone(null), "Europe/Oslo");
  assert.equal(marketTimeZone("NL"), "Europe/Oslo");
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
});
