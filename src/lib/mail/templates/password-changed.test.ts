import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordChangedEmail } from "./password-changed";

test("passwordChangedEmail body includes IP and timestamp", () => {
  const m = passwordChangedEmail({
    ip: "203.0.113.4",
    at: "2026-05-26 14:00 UTC",
    locale: "en",
    appName: "NativeSpin",
  });
  assert.ok(m.text.includes("203.0.113.4"));
  assert.ok(m.text.includes("2026-05-26 14:00 UTC"));
  assert.ok(m.html!.includes("203.0.113.4"));
});

test("passwordChangedEmail has no CTA (informational only)", () => {
  const m = passwordChangedEmail({
    ip: "x",
    at: "y",
    locale: "en",
    appName: "NativeSpin",
  });
  assert.equal(m.html!.match(/<a [^>]*href=/g)?.length ?? 0, 0);
});
