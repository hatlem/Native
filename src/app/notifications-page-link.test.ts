import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Regression guard for a real production bug: Notification.link is stored
// as an already-complete, locale-prefixed path (e.g. "/no/plan/open?list=x")
// built with the notice's own locale — an org's home-market language, not
// whatever locale the viewer's UI happens to be in. next-intl's <Link>
// (from @/i18n/navigation) always prepends the CURRENT locale to any local
// href it's given, with no awareness the href might already carry one —
// producing a broken double-prefixed URL (e.g. "/en/no/plan/open?...") and
// silently overriding the notice's intended language. Traced via next-intl
// 4.13.4's applyPathnamePrefix/prefixPathname source: any local href is
// unconditionally prefixed under this app's default localePrefix "always".
// The fix is a plain <a>, which doesn't reinterpret the href at all.
//
// Lives outside src/app/[locale]/ deliberately: Node's test runner treats a
// path segment like "[locale]" as a glob bracket-class, not a literal
// directory name, so any *.test.ts placed under src/app/[locale]/ is
// silently never discovered by this repo's `pnpm test` (0 tests, exit 0,
// no error) — confirmed by reproduction while writing this test.
test("notifications page renders stored links with a plain <a>, not next-intl's locale-prefixing Link", () => {
  const source = readFileSync(
    path.join(import.meta.dirname, "[locale]", "notifications", "page.tsx"),
    "utf8",
  );
  assert.ok(
    !/from ["']@\/i18n\/navigation["']/.test(source),
    "must not import from @/i18n/navigation — its Link would re-prefix an already-localized stored link",
  );
  assert.match(
    source,
    /<a\s+[\s\S]*?href=\{safeLink\}/,
    "notification rows must render their href with a plain <a>, not a locale-aware Link",
  );
});
