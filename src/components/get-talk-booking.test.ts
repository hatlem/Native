import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBookingFallbackHref } from "./get-talk-booking";

test("falls back to the gettalk booking page when handle is set", () => {
  assert.equal(resolveBookingFallbackHref("admirate"), "https://gettalk.co/admirate");
});

test("falls back to desk email when handle is missing", () => {
  assert.equal(resolveBookingFallbackHref(undefined), "mailto:desk@nativespin.com");
  assert.equal(resolveBookingFallbackHref(""), "mailto:desk@nativespin.com");
});
