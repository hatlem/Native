import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordResetEmail } from "./password-reset";

const URL = "https://atnative.com/en/reset-password/abc123";

test("passwordResetEmail returns subject, text, html with the URL embedded", () => {
  const m = passwordResetEmail({ url: URL, locale: "en", appName: "ATNative" });
  assert.ok(m.subject.toLowerCase().includes("password"));
  assert.ok(m.text.includes(URL));
  assert.ok(m.html!.includes(URL));
});

test("passwordResetEmail footer says password won't change unprompted", () => {
  const m = passwordResetEmail({ url: URL, locale: "en", appName: "ATNative" });
  assert.match(m.text, /password won't change|password will not change/i);
});
