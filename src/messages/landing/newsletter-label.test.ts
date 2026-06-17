import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard for the React #418 hydration cascade (CF Email Address
// Obfuscation). The newsletter sr-only <label> in NewsletterSignup.tsx must
// use `newsletter.emailLabel` — a plain accessibility label — NOT an
// email-shaped string. If a literal email reaches that SSR text node,
// Cloudflare rewrites it into a `__cf_email__` span + a CSP-blocked decode
// script, breaking hydration across every public footer.
const LOCALES = ["en", "no", "da", "sv", "fi", "de"] as const;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

for (const locale of LOCALES) {
  test(`${locale}: newsletter.emailLabel exists and is not email-shaped`, () => {
    const path = join(process.cwd(), "src/messages/landing", locale, "newsletter.json");
    const json = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    assert.ok(json.emailLabel, `missing newsletter.emailLabel in ${locale}`);
    assert.ok(
      !EMAIL_RE.test(json.emailLabel),
      `newsletter.emailLabel in ${locale} must not contain an email address (CF obfuscation → React #418): "${json.emailLabel}"`,
    );
  });
}
