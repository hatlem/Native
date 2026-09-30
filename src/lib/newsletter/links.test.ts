import { test } from "node:test";
import assert from "node:assert/strict";
import { newsletterFallbackLocale, newsletterLinks, newsletterUnsubToken } from "./links";

test("the unsubscribe token is stable per address and secret", () => {
  const a = newsletterUnsubToken("Ola@Firma.no", "s1");
  assert.equal(a, newsletterUnsubToken("ola@firma.no", "s1"), "case/space-insensitive");
  assert.equal(a, newsletterUnsubToken("ola@firma.no", "s1"), "re-mintable for every send");
  assert.notEqual(a, newsletterUnsubToken("kari@firma.no", "s1"));
  assert.notEqual(a, newsletterUnsubToken("ola@firma.no", "s2"), "keyed by the secret");
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
});

test("links carry a validated lang hint", () => {
  const l = newsletterLinks({ origin: "https://x.test", confirmRaw: "c", unsubRaw: "u", locale: "no" });
  assert.equal(l.confirmUrl, "https://x.test/api/newsletter/confirm?token=c&lang=no");
  assert.equal(l.unsubUrl, "https://x.test/api/newsletter/unsubscribe?token=u&lang=no");
  const evil = newsletterLinks({ origin: "https://x.test", confirmRaw: "c", unsubRaw: "u", locale: "//evil" });
  assert.ok(evil.confirmUrl.endsWith("&lang=en"));
});

test("fallback locale: link hint, then cookie, then default", () => {
  assert.equal(newsletterFallbackLocale("sv", "de"), "sv");
  assert.equal(newsletterFallbackLocale(null, "de"), "de");
  assert.equal(newsletterFallbackLocale("xx", undefined), "en");
});

test("fallback locale: an old link without lang follows the browser language", () => {
  assert.equal(newsletterFallbackLocale(null, undefined, "nb-NO,nb;q=0.9,en;q=0.8"), "no");
  assert.equal(newsletterFallbackLocale(null, undefined, "fr-FR,de;q=0.7"), "de");
  // An explicit choice (the cookie) still beats the browser default.
  assert.equal(newsletterFallbackLocale(null, "sv", "nb-NO"), "sv");
  // A junk cookie doesn't mask the browser language.
  assert.equal(newsletterFallbackLocale(null, "xx", "da"), "da");
  assert.equal(newsletterFallbackLocale(null, undefined, "fr-FR"), "en");
});
