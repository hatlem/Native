import { test } from "node:test";
import assert from "node:assert/strict";
import { displayTimeZone } from "./time-zone";

test("displayTimeZone: the org market wins, then the UI language", () => {
  assert.equal(displayTimeZone({ marketCode: "NO", locale: "en" }), "Europe/Oslo");
  assert.equal(displayTimeZone({ marketCode: null, locale: "fi" }), "Europe/Helsinki");
  assert.equal(displayTimeZone({ marketCode: "XX", locale: "zz" }), "Europe/London");
});

test("a share view at 07:51 UTC reads 09:51 in Oslo (CEST)", () => {
  const fmt = new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: displayTimeZone({ marketCode: "NO", locale: "no" }),
  });
  assert.equal(fmt.format(new Date("2026-09-30T07:51:00Z")), "09:51");
});
