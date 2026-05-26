import { test } from "node:test";
import assert from "node:assert/strict";
import { newSigninAlertEmail } from "./new-signin-alert";

test("newSigninAlertEmail body includes the new IP", () => {
  const m = newSigninAlertEmail({
    ip: "198.51.100.7",
    at: "2026-05-26 14:00 UTC",
    resetUrl: "https://nativespin.com/en/forgot-password",
    locale: "en",
    appName: "NativeSpin",
  });
  assert.ok(m.text.includes("198.51.100.7"));
});

test("newSigninAlertEmail CTA links to the reset URL", () => {
  const url = "https://nativespin.com/en/forgot-password";
  const m = newSigninAlertEmail({
    ip: "x",
    at: "y",
    resetUrl: url,
    locale: "en",
    appName: "NativeSpin",
  });
  assert.ok(m.html!.includes(url));
});
