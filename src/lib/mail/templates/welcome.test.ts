import { test } from "node:test";
import assert from "node:assert/strict";
import { welcomeEmail } from "./welcome";

test("welcomeEmail subject includes the app name", () => {
  const m = welcomeEmail({ catalogUrl: "https://nativespin.com/en/catalog", locale: "en", appName: "NativeSpin" });
  assert.ok(m.subject.includes("NativeSpin"));
});

test("welcomeEmail body references the app name", () => {
  const m = welcomeEmail({ catalogUrl: "https://nativespin.com/en/catalog", locale: "en", appName: "NativeSpin" });
  assert.ok(m.text.includes("NativeSpin"));
});

test("welcomeEmail CTA points to the catalog url", () => {
  const url = "https://nativespin.com/en/catalog";
  const m = welcomeEmail({ catalogUrl: url, locale: "en", appName: "NativeSpin" });
  assert.ok(m.html!.includes(url));
});
