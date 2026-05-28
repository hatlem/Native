import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newRateCardToken,
  rateCardExpiryFromNow,
  checkRateCardRequest,
  rateCardLink,
} from "./tokens";

test("newRateCardToken yields ~32 url-safe chars, unique per call", () => {
  const a = newRateCardToken();
  const b = newRateCardToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length >= 30 && a.length <= 34);
});

test("rateCardExpiryFromNow defaults to 30 days from given now", () => {
  const now = new Date("2026-05-01T00:00:00Z");
  const exp = rateCardExpiryFromNow(30, now);
  assert.equal(exp.toISOString(), "2026-05-31T00:00:00.000Z");
});

test("checkRateCardRequest returns null for missing request", () => {
  assert.equal(checkRateCardRequest(null), null);
  assert.equal(checkRateCardRequest(undefined), null);
});

test("checkRateCardRequest reports cancelled, responded, expired in that order", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const future = new Date("2026-07-01T00:00:00Z");
  const past = new Date("2026-05-01T00:00:00Z");
  assert.deepEqual(
    checkRateCardRequest({ expiresAt: future, respondedAt: null, cancelledAt: now }, now),
    { ok: false, reason: "cancelled" },
  );
  assert.deepEqual(
    checkRateCardRequest({ expiresAt: future, respondedAt: now, cancelledAt: null }, now),
    { ok: false, reason: "responded" },
  );
  assert.deepEqual(
    checkRateCardRequest({ expiresAt: past, respondedAt: null, cancelledAt: null }, now),
    { ok: false, reason: "expired" },
  );
});

test("checkRateCardRequest returns ok when active", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const future = new Date("2026-07-01T00:00:00Z");
  assert.deepEqual(
    checkRateCardRequest({ expiresAt: future, respondedAt: null, cancelledAt: null }, now),
    { ok: true },
  );
});

test("rateCardLink encodes the token + locale", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://nativespin.com";
  assert.equal(
    rateCardLink("abc-123", "no"),
    "https://nativespin.com/no/rate-card/abc-123",
  );
});
