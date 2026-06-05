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

test("metricsReportLink builds a localized token URL", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://nativespin.com/";
  assert.equal(metricsReportLink("abc def", "no"), "https://nativespin.com/no/campaign-report/abc%20def");
});
