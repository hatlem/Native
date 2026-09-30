import { test } from "node:test";
import assert from "node:assert/strict";
import { accountExistsEmail } from "./account-exists";
import { strings, type Locale } from "./strings";

const URL = "https://nativespin.com/no/magic-link/abc123";
const LOCALES: Locale[] = ["en", "no", "sv", "da", "de", "fi"];

test("accountExistsEmail embeds the sign-in link in text and html", () => {
  const m = accountExistsEmail({ url: URL, locale: "no", appName: "NativeSpin" });
  assert.ok(m.subject.includes("NativeSpin"));
  assert.ok(m.text.includes(URL));
  assert.ok(m.html.includes(URL));
  assert.equal(m.text.includes("<"), false);
});

test("accountExists copy is translated in every locale", () => {
  const en = strings("en").accountExists;
  for (const loc of LOCALES.filter((l) => l !== "en")) {
    const s = strings(loc).accountExists;
    assert.notEqual(s.heading, en.heading, `${loc}: heading still English`);
    assert.ok(s.body("NativeSpin").includes("NativeSpin"), `${loc}: body lost the app name`);
  }
});
