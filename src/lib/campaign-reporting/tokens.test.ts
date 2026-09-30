import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newMetricsToken,
  metricsExpiryFromNow,
  checkMetricsRequest,
  metricsReportLink,
} from "./tokens";

test("newMetricsToken is url-safe and unique", () => {
  const a = newMetricsToken();
  const b = newMetricsToken();
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});

test("metricsExpiryFromNow adds days in UTC", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  assert.equal(metricsExpiryFromNow(30, now).toISOString(), "2026-07-01T00:00:00.000Z");
});

test("checkMetricsRequest verdicts", () => {
  const now = new Date("2026-06-10T00:00:00Z");
  assert.equal(checkMetricsRequest(null, now), null);
  assert.deepEqual(checkMetricsRequest({ expiresAt: new Date("2026-07-01T00:00:00Z"), respondedAt: null, cancelledAt: null }, now), { ok: true });
  assert.deepEqual(checkMetricsRequest({ expiresAt: new Date("2026-06-01T00:00:00Z"), respondedAt: null, cancelledAt: null }, now), { ok: false, reason: "expired" });
  assert.deepEqual(checkMetricsRequest({ expiresAt: new Date("2026-07-01T00:00:00Z"), respondedAt: new Date(), cancelledAt: null }, now), { ok: false, reason: "responded" });
  assert.deepEqual(checkMetricsRequest({ expiresAt: new Date("2026-07-01T00:00:00Z"), respondedAt: null, cancelledAt: new Date() }, now), { ok: false, reason: "cancelled" });
});

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("metricsReportLink builds a localized token URL", () => {
  withEnv({ AUTH_URL: undefined, NEXTAUTH_URL: undefined, NEXT_PUBLIC_SITE_URL: "https://nativespin.com/" }, () => {
    assert.equal(metricsReportLink("abc def", "no"), "https://nativespin.com/no/campaign-report/abc%20def");
  });
});

test("metricsReportLink uses the canonical app origin (AUTH_URL first)", () => {
  // Prod sets AUTH_URL; before, only NEXT_PUBLIC_SITE_URL was read and an
  // unset one fell back to http://localhost:3000 in publisher emails.
  withEnv({ AUTH_URL: "https://nativespin.com", NEXTAUTH_URL: undefined, NEXT_PUBLIC_SITE_URL: undefined }, () => {
    assert.equal(metricsReportLink("tok", "sv"), "https://nativespin.com/sv/campaign-report/tok");
  });
});
