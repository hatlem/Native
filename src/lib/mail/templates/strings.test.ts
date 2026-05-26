import { test } from "node:test";
import assert from "node:assert/strict";
import { strings, type Locale } from "./strings";

const LOCALES: Locale[] = ["en", "no", "sv", "da", "de", "fi"];

test("every locale has full coverage of all five email types", () => {
  for (const loc of LOCALES) {
    const s = strings(loc);
    assert.ok(s.magicLink.heading, `${loc}: missing magicLink.heading`);
    assert.ok(s.passwordReset.heading, `${loc}: missing passwordReset.heading`);
    assert.ok(s.welcome.heading, `${loc}: missing welcome.heading`);
    assert.ok(s.passwordChanged.heading, `${loc}: missing passwordChanged.heading`);
    assert.ok(s.newSigninAlert.heading, `${loc}: missing newSigninAlert.heading`);
  }
});

test("non-English locales are actually translated (not stubbed to en)", () => {
  // The magic-link CTA in English is "Sign in". If a locale's CTA still says
  // "Sign in", it's an unfinished stub.
  const enCta = strings("en").magicLink.cta;
  for (const loc of LOCALES.filter((l) => l !== "en")) {
    const cta = strings(loc).magicLink.cta;
    assert.notEqual(cta, enCta, `${loc}: magicLink.cta still equals English ("${enCta}") — translate it`);
  }
});

test("subject functions interpolate the app name in every locale", () => {
  for (const loc of LOCALES) {
    const subj = strings(loc).magicLink.subject("ATNative");
    assert.ok(subj.includes("ATNative"), `${loc}: subject didn't include app name`);
  }
});

test("body templates that take ip+at use both arguments", () => {
  for (const loc of LOCALES) {
    const pc = strings(loc).passwordChanged.body("203.0.113.4", "2026-05-26 14:00 UTC");
    assert.ok(pc.includes("203.0.113.4"), `${loc}: passwordChanged.body missing IP`);
    assert.ok(pc.includes("2026-05-26 14:00 UTC"), `${loc}: passwordChanged.body missing timestamp`);
    const ns = strings(loc).newSigninAlert.body("198.51.100.7", "2026-05-26 14:00 UTC");
    assert.ok(ns.includes("198.51.100.7"), `${loc}: newSigninAlert.body missing IP`);
  }
});

test("unknown locale falls back to en", () => {
  assert.equal(strings("klingon").magicLink.cta, strings("en").magicLink.cta);
});
