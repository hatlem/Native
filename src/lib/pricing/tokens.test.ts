import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newPriceRequestToken,
  expiryFromNow,
  DEFAULT_REQUEST_TTL_DAYS,
  checkRequest,
} from "./tokens";

test("newPriceRequestToken produces url-safe strings >= 32 chars", () => {
  const t = newPriceRequestToken();
  assert.ok(t.length >= 32, `got length ${t.length}`);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
});

test("newPriceRequestToken is unique across many calls", () => {
  const tokens = new Set(Array.from({ length: 1000 }, () => newPriceRequestToken()));
  assert.equal(tokens.size, 1000);
});

test("expiryFromNow uses DEFAULT_REQUEST_TTL_DAYS by default", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const e = expiryFromNow(undefined, now);
  const expected = new Date("2026-01-31T00:00:00Z");
  assert.equal(e.toISOString(), expected.toISOString());
  assert.equal(DEFAULT_REQUEST_TTL_DAYS, 30);
});

test("checkRequest returns null for missing", () => {
  assert.equal(checkRequest(null), null);
  assert.equal(checkRequest(undefined), null);
});

test("checkRequest detects expired", () => {
  const v = checkRequest(
    {
      expiresAt: new Date("2026-01-01"),
      respondedAt: null,
      cancelledAt: null,
    },
    new Date("2026-02-01"),
  );
  assert.deepEqual(v, { ok: false, reason: "expired" });
});

test("checkRequest detects already-responded", () => {
  const v = checkRequest(
    {
      expiresAt: new Date("2027-01-01"),
      respondedAt: new Date("2026-01-15"),
      cancelledAt: null,
    },
    new Date("2026-02-01"),
  );
  assert.deepEqual(v, { ok: false, reason: "responded" });
});

test("checkRequest detects cancelled", () => {
  const v = checkRequest(
    {
      expiresAt: new Date("2027-01-01"),
      respondedAt: null,
      cancelledAt: new Date("2026-01-15"),
    },
    new Date("2026-02-01"),
  );
  assert.deepEqual(v, { ok: false, reason: "cancelled" });
});

test("checkRequest returns ok for live", () => {
  const v = checkRequest(
    {
      expiresAt: new Date("2027-01-01"),
      respondedAt: null,
      cancelledAt: null,
    },
    new Date("2026-02-01"),
  );
  assert.deepEqual(v, { ok: true });
});
