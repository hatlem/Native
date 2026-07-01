import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowBookingBanner } from "./booking-prompt";

test("shows for an advertiser who hasn't dismissed", () => {
  assert.equal(shouldShowBookingBanner({ audience: "advertiser", dismissedAt: null }), true);
});

test("shows for an agency who hasn't dismissed", () => {
  assert.equal(shouldShowBookingBanner({ audience: "agency", dismissedAt: null }), true);
});

test("hidden once dismissed", () => {
  assert.equal(shouldShowBookingBanner({ audience: "advertiser", dismissedAt: new Date() }), false);
});

test("hidden for non-buyer audiences (desk, publisher, public)", () => {
  for (const audience of ["desk", "superadmin", "publisher", "writer", "public"]) {
    assert.equal(shouldShowBookingBanner({ audience, dismissedAt: null }), false);
  }
});
