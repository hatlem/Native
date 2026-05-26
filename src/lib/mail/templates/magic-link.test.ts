import { test } from "node:test";
import assert from "node:assert/strict";
import { magicLinkEmail } from "./magic-link";

const URL = "https://nativespin.com/en/magic-link/abc123";

test("magicLinkEmail returns subject, text, html with the URL embedded", () => {
  const m = magicLinkEmail({ url: URL, locale: "en", appName: "NativeSpin" });
  assert.ok(m.subject.includes("NativeSpin"));
  assert.ok(m.text.includes(URL));
  assert.ok(m.html!.includes(URL));
});

test("magicLinkEmail falls back to en for unknown locale", () => {
  const m = magicLinkEmail({ url: URL, locale: "klingon", appName: "NativeSpin" });
  assert.ok(m.subject.includes("NativeSpin"));
  assert.ok(m.text.includes(URL));
});

test("magicLinkEmail text body is plain (no HTML tags)", () => {
  const m = magicLinkEmail({ url: URL, locale: "en", appName: "NativeSpin" });
  assert.equal(m.text.includes("<"), false);
  assert.equal(m.text.includes(">"), false);
});
