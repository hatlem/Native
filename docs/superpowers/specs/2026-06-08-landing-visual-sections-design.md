# Landing visual sections (Increment 1) — design

**Date:** 2026-06-08
**Branch:** `feat/landing-visual-sections`
**Status:** Approved scope; ready for implementation planning.

## Context

The marketing landing page (`src/app/[locale]/(marketing)/page.tsx`) is text-dominant editorial copy in the "Bone" design system. It *tells* the native-advertising story but never *shows* the product — no example of what a native article looks like, no native-vs-display contrast, no glimpse of the brief→quote flow. Prototypes in `docs/marketing-image-mockups.html` and `docs/marketing-image-playground.html` validated the visual direction.

This increment adds five **pure-CSS** visual sections to the landing page. It does **not** include the interactive "preview your own native ad" tool — that is Increment 2 with its own spec.

## Goals

- Make the landing page *show* the product, not just describe it.
- Stay 100% within the Bone design system (cream paper, ink, Inter, namespaced `.bn` CSS).
- No image assets, no third-party trademarks — all visuals are CSS, using a clearly-fictional placeholder masthead.
- English-first copy via the existing per-section i18n structure.
- Ship behind a branch + PR; `main` auto-deploys to prod, so nothing lands without explicit merge.

## Non-goals (explicitly deferred)

- The interactive AI "preview your own native ad" tool → **Increment 2**.
- Magazine/newspaper **cover** thumbnails → deferred (would require fabricating cover art for real network titles; revisit when we have real cover assets or a safe generic treatment).
- Translating the new copy into no/sv/da/de/fi → follow-up after English ships (locale files stubbed from English so the page never 500s on a missing key).
- Any use of real, scraped newspaper logos in the fabricate-an-ad visuals.

## Approach

**Component-per-visual.** Each visual is a focused **server component** under `src/app/[locale]/(marketing)/_components/`, rendering static markup with classes from the Bone system. Styles are appended to `src/app/landing-styles.ts` (the single `STYLES` string), every selector namespaced `.bn .<name>` so it cannot collide with the app shell, desk console, or publisher portal. Copy comes from a new i18n section `preview`.

Rejected alternatives: inline JSX in `page.tsx` (already 465 lines; mocks are markup-heavy → bloat), and pre-rendered SVG/PNG assets (not responsive, not theme-aware, copy escapes i18n).

## The five visuals

All components are presentational and take no required props except where noted. Each renders the fictional masthead via a shared constant so the placeholder name lives in exactly one place and is unmistakably not a real publication.

### 1. `HeroArticleMock.tsx`
- **Slots into:** the hero, replacing/with the right-hand `hero-side` stat column (final placement decided in the plan; keep the 3–5× stat or move it below).
- **Renders:** a small browser/article frame — fictional masthead, an `Annonsørinnhold`-style sponsored tag, headline, italic standfirst, byline, a CSS gradient "photo" block, and 2-column faux body lines.
- **Purpose:** prove "an ad people finish" at a glance.

### 2. `NativeVsDisplay.tsx`
- **Slots into:** the "Two formats, two different jobs" section, above the existing comparison table.
- **Renders:** two frames side by side — a clean native article (left, ✓) vs. an ad-saturated page with leaderboard/in-content/popup ad placeholders (right, ✕).
- **Responsive:** stacks vertically below ~860px.

### 3. `GoldenRuleExcerpt.tsx`
- **Slots into:** the dark "If the writing is bad…" Golden Rule section.
- **Renders:** subtle SVG paper-grain overlay + a pulled article excerpt set like print (drop cap, serif via Georgia, generic copy) beside the existing headline.
- **Constraint:** dark-section palette already exists (`.bn .rule`); new styles extend it.

### 4. `BriefToQuote.tsx`
- **Slots into:** the "How buying works" section.
- **Renders:** a brief-form panel (objective, markets, budget, audience, dates) → arrow → a firm itemised quote panel (line items, "firm price" badge, one-contract total). Anonymised numbers; generic title names.
- **Responsive:** arrow rotates / panels stack on narrow screens.

### 5. Publisher strip polish
- **Touches:** existing `PublisherStrip.tsx` / `.pub-strip` styles.
- **Change:** render real `Publisher.logoUrl` logos in a single ink tone (CSS filter/opacity) for visual calm; text-chip fallback for null logos is unchanged. **Real network publishers only** — no new logos introduced.

## Styling

- All new CSS appended to `landing-styles.ts`, namespaced `.bn`.
- Reuse existing tokens (`--paper`, `--ink`, `--ink-soft`, `--ink-mute`, `--hair`, `--rule`, market flag colors).
- Grain via inline SVG data-URI (as in the prototype). No external requests.
- Respect the strict CSP: styles load through the existing nonce'd `<style>` block in `LandingShell`; no inline `style=` attributes that violate CSP (use classes).

## i18n

- New section file `src/messages/landing/en/preview.json` with all new strings (headlines, standfirsts, labels, the fictional masthead name, vs-display row labels, brief/quote field labels).
- Register `"preview"` in `LANDING_SECTIONS` (`src/i18n/request.ts`).
- Stub `no/sv/da/de/fi/preview.json` as copies of English so no locale 500s; real translation is a follow-up.
- Components read copy via `getTranslations({ locale, namespace: "landing" })` → `t("preview.xxx")`, consistent with existing sections.

## Generic masthead policy

A single shared constant (e.g. in the `preview` i18n section, key `preview.mastheadName`) holds the placeholder masthead. It must be obviously fictional and not collide with any real publication. All fabricate-an-ad visuals (#1, #2, #4) use it. No real masthead names or logos appear in these mocks.

## Testing

These are pure presentational server components. Testing is light:
- A render-smoke test under the existing `node:test` runner asserting each component renders without throwing and contains a key marker string. (`src/app/landing-styles.ts` and the test conventions per project memory — node:test, not Vitest.)
- Manual visual verification via the local app (seeded DB) before PR.
- No behavioral/unit logic to test (no data transforms beyond existing catalog queries, which are untouched).

## Deploy / process

- All work on `feat/landing-visual-sections`.
- `main` auto-deploys to prod on push, so the branch is merged only after review.
- One PR for Increment 1.

## Open items resolved

- **Hero right column:** keep the 3–5× stat *and* add the article mock, or replace — decided during planning/implementation based on layout fit; both kept is the default.
- **Covers:** deferred (above).
