import { test } from "node:test";
import assert from "node:assert/strict";
import { welcomeEmail } from "./welcome";

test("welcomeEmail subject includes the app name", () => {
  const m = welcomeEmail({ catalogUrl: "https://atnative.com/en/catalog", locale: "en", appName: "ATNative" });
  assert.ok(m.subject.includes("ATNative"));
});

test("welcomeEmail body references the app name", () => {
  const m = welcomeEmail({ catalogUrl: "https://atnative.com/en/catalog", locale: "en", appName: "ATNative" });
  assert.ok(m.text.includes("ATNative"));
});

test("welcomeEmail CTA points to the catalog url", () => {
  const url = "https://atnative.com/en/catalog";
  const m = welcomeEmail({ catalogUrl: url, locale: "en", appName: "ATNative" });
  assert.ok(m.html!.includes(url));
});
