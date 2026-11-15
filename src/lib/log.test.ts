import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecord, resetAlertStateForTests, shouldAlert } from "./log";

test("buildRecord: carries level, event, timestamp and fields", () => {
  const rec = buildRecord("info", "auth.signin_ok", { userId: "u1" }, new Date("2026-01-02T03:04:05Z"));
  assert.deepEqual(rec, { ts: "2026-01-02T03:04:05.000Z", level: "info", event: "auth.signin_ok", userId: "u1" });
});

test("buildRecord: serializes errors with name, message and code", () => {
  const err = Object.assign(new Error("boom"), { code: "P2002" });
  const rec = buildRecord("error", "x.failed", { err });
  const e = rec.err as Record<string, unknown>;
  assert.equal(e.name, "Error");
  assert.equal(e.message, "boom");
  assert.equal(e.code, "P2002");
  assert.equal(typeof e.stack, "string");
});

test("buildRecord: redacts secret-looking keys and drops undefined", () => {
  const rec = buildRecord("info", "x", { password: "p", apiKey: "k", resetToken: "t", note: undefined, ok: 1 });
  assert.equal(rec.password, "[redacted]");
  assert.equal(rec.apiKey, "[redacted]");
  assert.equal(rec.resetToken, "[redacted]");
  assert.equal("note" in rec, false);
  assert.equal(rec.ok, 1);
});

test("shouldAlert: one alert per event per window, capped in total", () => {
  resetAlertStateForTests();
  const t0 = 1_000_000;
  assert.equal(shouldAlert("a", t0), true);
  assert.equal(shouldAlert("a", t0 + 1000), false, "same event is deduped inside the window");
  for (const e of ["b", "c", "d", "e"]) assert.equal(shouldAlert(e, t0 + 2000), true);
  assert.equal(shouldAlert("f", t0 + 3000), false, "sixth distinct event exceeds the window cap");
  assert.equal(shouldAlert("a", t0 + 5 * 60_000 + 1), true, "a new window resets");
});
