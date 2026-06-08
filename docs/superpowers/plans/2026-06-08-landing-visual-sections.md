# Landing Visual Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five pure-CSS visual sections to the marketing landing page so it *shows* the native-advertising product (article mock, native-vs-display, golden-rule excerpt, brief→quote, monochrome publisher logos) instead of only describing it.

**Architecture:** Each visual is a small presentational **async server component** under `src/app/[locale]/(marketing)/_components/`, rendering Bone-system markup. All styles append to the single `STYLES` string in `src/app/landing-styles.ts`, namespaced `.bn`. All copy lives in a new i18n section `preview` (English first; other 5 locales stubbed from English). Components are wired into existing sections of `page.tsx`.

**Tech Stack:** Next.js App Router (RSC), next-intl (`getTranslations`), CSS-in-JS string (`landing-styles.ts`), node:test via `pnpm test` (`tsx --test`), Prisma (untouched here).

**Branch:** `feat/landing-visual-sections` (already created). `main` auto-deploys to prod — merge only via PR.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/messages/landing/en/preview.json` | English copy for all five visuals (source of truth) |
| `src/messages/landing/{no,sv,da,de,fi}/preview.json` | Locale stubs (copies of English; translated later) |
| `src/i18n/request.ts` | Register `"preview"` in `LANDING_SECTIONS` |
| `src/app/landing-styles.ts` | Append namespaced CSS for the visuals; tweak `.pub-strip-logo` |
| `src/app/[locale]/(marketing)/_components/HeroArticleMock.tsx` | Native-article preview (hero) |
| `src/app/[locale]/(marketing)/_components/NativeVsDisplay.tsx` | Native vs display side-by-side |
| `src/app/[locale]/(marketing)/_components/GoldenRuleExcerpt.tsx` | Drop-cap pulled excerpt (dark section) |
| `src/app/[locale]/(marketing)/_components/BriefToQuote.tsx` | Brief→quote product mock |
| `src/app/[locale]/(marketing)/page.tsx` | Import + slot the four components |
| `src/lib/marketing/preview-assets.test.ts` | Contract tests: i18n key parity + CSS selectors present |

**Testing strategy (why contract tests, not render tests):** these components are async RSCs that call `getTranslations`; rendering them in `node:test` would require mocking next-intl request context for little value. The real failure modes are (a) a missing/renamed i18n key → runtime throw, and (b) missing CSS → unstyled markup. Both are caught by contract tests. Component wiring/typing is caught by `pnpm build` (TypeScript), and appearance by a manual visual pass. This is the pragmatic, high-signal test set for a presentational increment.

---

## Task 1: i18n `preview` section (copy + registration)

**Files:**
- Create: `src/messages/landing/en/preview.json`
- Create: `src/messages/landing/no/preview.json`, `.../sv/preview.json`, `.../da/preview.json`, `.../de/preview.json`, `.../fi/preview.json`
- Modify: `src/i18n/request.ts:4-18` (add `"preview"` to `LANDING_SECTIONS`)
- Test: `src/lib/marketing/preview-assets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/marketing/preview-assets.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES = ["en", "no", "sv", "da", "de", "fi"] as const;

function readPreview(locale: string): Record<string, unknown> {
  const p = join(process.cwd(), "src/messages/landing", locale, "preview.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

test("en preview.json has every required key", () => {
  const en = readPreview("en");
  const required = [
    "mastheadName", "heroTag", "heroNav1", "heroNav2", "heroNav3",
    "heroHeadline", "heroStandfirst", "heroByline",
    "vsNativeLabel", "vsDisplayLabel", "vsNativeHeadline", "vsDisplayName",
    "vsDisplayHeadline", "vsAdLeaderboard", "vsAdBox", "vsAdInContent",
    "vsAdTag", "vsPopupTitle", "vsPopupCta", "vsCaption",
    "ruleExcerptTag", "ruleExcerptCap", "ruleExcerptBody",
    "briefTitle", "briefObjLabel", "briefObjValue", "briefMarketsLabel",
    "briefMarketsValue", "briefBudgetLabel", "briefBudgetValue",
    "briefDatesLabel", "briefDatesValue",
    "quoteTitle", "quoteBadge", "quoteR1Title", "quoteR1Meta", "quoteR1Price",
    "quoteR2Title", "quoteR2Meta", "quoteR2Price", "quoteR3Title", "quoteR3Meta",
    "quoteR3Price", "quoteTotalLabel", "quoteTotalValue",
  ];
  for (const k of required) {
    assert.ok(k in en, `missing key: ${k}`);
    assert.equal(typeof en[k], "string", `key not string: ${k}`);
  }
});

test("all locales have the same key set as en (stubs present)", () => {
  const enKeys = Object.keys(readPreview("en")).sort();
  for (const loc of LOCALES) {
    const keys = Object.keys(readPreview(loc)).sort();
    assert.deepEqual(keys, enKeys, `locale ${loc} key mismatch`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -A2 preview-assets`
Expected: FAIL — `ENOENT` (preview.json files don't exist yet).

- [ ] **Step 3: Create the English source file**

Create `src/messages/landing/en/preview.json`:

```json
{
  "mastheadName": "Dagslys",
  "heroTag": "Sponsored content",
  "heroNav1": "News",
  "heroNav2": "Business",
  "heroNav3": "Culture",
  "heroHeadline": "The quiet shift that remade a fjord town",
  "heroStandfirst": "Ten patient years turned the unthinkable into the everyday. We went to see how.",
  "heroByline": "By the editorial desk · Photo: archive · 8 min read",
  "vsNativeLabel": "Native — reads like the page",
  "vsDisplayLabel": "Display — fighting for attention",
  "vsNativeHeadline": "An ordinary Tuesday, seen from above",
  "vsDisplayName": "DailyClicks",
  "vsDisplayHeadline": "The headline you came for",
  "vsAdLeaderboard": "Leaderboard ad",
  "vsAdBox": "Ad",
  "vsAdInContent": "In-content ad",
  "vsAdTag": "AD",
  "vsPopupTitle": "Subscribe for 70% off!",
  "vsPopupCta": "Yes, sign me up",
  "vsCaption": "A page you'd stay on vs. a page you'd flee.",
  "ruleExcerptTag": "From a native placement",
  "ruleExcerptCap": "T",
  "ruleExcerptBody": "he fjord doesn't announce itself. You round the last bend and it's simply there — flat, grey, enormous — the way it has been for ten thousand years. What's new is the silence.",
  "briefTitle": "Step 01 · Your brief",
  "briefObjLabel": "Objective",
  "briefObjValue": "Launch awareness — premium EV",
  "briefMarketsLabel": "Markets",
  "briefMarketsValue": "NO · SE · DK",
  "briefBudgetLabel": "Budget",
  "briefBudgetValue": "€40–60k",
  "briefDatesLabel": "Dates",
  "briefDatesValue": "Sept–Oct",
  "quoteTitle": "Step 03 · Firm quote · 18 hrs later",
  "quoteBadge": "Firm price · named desk buyer",
  "quoteR1Title": "Title A",
  "quoteR1Meta": "Native article · NO",
  "quoteR1Price": "€18,400",
  "quoteR2Title": "Title B",
  "quoteR2Meta": "Sponsored feature · SE",
  "quoteR2Price": "€21,900",
  "quoteR3Title": "Title C",
  "quoteR3Meta": "Native + newsletter · DK",
  "quoteR3Price": "€12,300",
  "quoteTotalLabel": "One contract",
  "quoteTotalValue": "€52,600"
}
```

- [ ] **Step 4: Create the five locale stubs (copies of English)**

Run (copies English verbatim so no locale 500s on a missing key; real translation is a follow-up):

```bash
cd /Users/andreashatlem/Native
for loc in no sv da de fi; do
  cp src/messages/landing/en/preview.json "src/messages/landing/$loc/preview.json"
done
```

- [ ] **Step 5: Register the section**

In `src/i18n/request.ts`, add `"preview"` to the `LANDING_SECTIONS` array (after `"team"`):

```ts
const LANDING_SECTIONS = [
  "hero",
  "why",
  "vs",
  "rule",
  "pubs",
  "catalog",
  "stats",
  "how",
  "obj",
  "endCta",
  "foot",
  "newsletter",
  "team",
  "preview",
] as const;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test 2>&1 | grep -A2 preview-assets`
Expected: the two i18n tests PASS. (The CSS test added in Task 2 will fail until then — that's expected; you can scope this run with `pnpm exec tsx --test src/lib/marketing/preview-assets.test.ts` and ignore the not-yet-written CSS assertions if you split, but simplest is to add the CSS test in Task 2.)

- [ ] **Step 7: Commit**

```bash
git add src/messages/landing/*/preview.json src/i18n/request.ts src/lib/marketing/preview-assets.test.ts
git commit -m "feat(landing): add preview i18n section + contract test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Append visual CSS to the Bone design system

**Files:**
- Modify: `src/app/landing-styles.ts` (append before the closing `` ` `` of `STYLES`; tweak existing `.pub-strip-logo`)
- Test: `src/lib/marketing/preview-assets.test.ts` (add a CSS-presence test)

- [ ] **Step 1: Add the failing CSS test**

Append to `src/lib/marketing/preview-assets.test.ts`:

```ts
import { STYLES } from "../../app/landing-styles";

test("STYLES contains the preview-visual selectors", () => {
  for (const sel of [
    ".bn .na-frame",
    ".bn .na-photo",
    ".bn .vsd",
    ".bn .vsd .popup",
    ".bn .rule-excerpt",
    ".bn .bq-flow",
    ".bn .bq-total",
    "--bn-grain",
  ]) {
    assert.ok(STYLES.includes(sel), `STYLES missing: ${sel}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test src/lib/marketing/preview-assets.test.ts 2>&1 | tail -20`
Expected: FAIL — `STYLES missing: .bn .na-frame`.

- [ ] **Step 3: Append the CSS**

In `src/app/landing-styles.ts`, immediately **before** the final closing `` `; `` of the `STYLES` template literal, paste this block verbatim:

```css
/* ── Preview visuals (landing showcase mocks) — namespaced .bn ── */
.bn { --bn-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E"); }

.bn .hero-showcase { margin-top: clamp(28px, 3.4vw, 48px); }

/* generic native-article frame */
.bn .na-frame { background:#fff; border:1.5px solid var(--ink); border-radius:7px; overflow:hidden; box-shadow:0 18px 44px -26px rgba(20,17,12,.55); max-width:680px; }
.bn .na-bar { display:flex; align-items:center; gap:7px; padding:9px 12px; background:var(--paper-2); border-bottom:1px solid var(--hair); }
.bn .na-bar .dot { width:9px; height:9px; border-radius:50%; background:var(--ink-mute); opacity:.45; }
.bn .na-bar .url { margin-left:8px; font-size:10.5px; color:var(--ink-mute); background:#fff; border:1px solid var(--hair); border-radius:20px; padding:3px 12px; }
.bn .na-masthead { display:flex; justify-content:space-between; align-items:center; padding:13px 20px; border-bottom:2px solid #14110C; }
.bn .na-masthead .na-name { font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:700; color:#14110C; letter-spacing:.01em; }
.bn .na-masthead .na-nav { display:flex; gap:12px; font-size:9px; text-transform:uppercase; letter-spacing:.14em; color:var(--ink-mute); font-weight:600; }
.bn .na-art { padding:20px 26px 28px; color:#14110C; }
.bn .na-tag { display:inline-flex; align-items:center; gap:7px; font-size:9px; text-transform:uppercase; letter-spacing:.16em; font-weight:700; color:var(--ink-mute); border:1px solid var(--hair); padding:4px 9px; border-radius:2px; background:#f4f0e6; }
.bn .na-art h3 { font-family:Georgia,serif; font-size:clamp(20px,2.4vw,28px); line-height:1.08; letter-spacing:-.01em; margin:13px 0 11px; font-weight:700; max-width:22ch; }
.bn .na-art .na-standfirst { font-family:Georgia,serif; font-style:italic; font-size:15px; color:var(--ink-soft); line-height:1.5; margin:0 0 14px; max-width:46ch; }
.bn .na-art .na-byline { font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:var(--ink-mute); margin-bottom:16px; }
.bn .na-photo { height:190px; border-radius:3px; position:relative; overflow:hidden; background:radial-gradient(120% 120% at 20% 10%,#c9b89a,#a8906b 40%,#6d5a40); }
.bn .na-photo::after { content:""; position:absolute; inset:0; background-image:var(--bn-grain); mix-blend-mode:overlay; opacity:.45; }
.bn .na-cols { column-count:2; column-gap:24px; margin-top:18px; }
.bn .na-cols i { display:block; height:7px; border-radius:3px; background:rgba(20,17,12,.12); margin-bottom:9px; }
.bn .na-cols i.s { width:60%; }
.bn .na-cols i.f { width:42%; background:rgba(20,17,12,.2); }

/* native vs display */
.bn .vsd { display:grid; grid-template-columns:1fr 1fr; gap:22px; align-items:start; margin-bottom:clamp(20px,2.4vw,32px); }
.bn .vsd .vsd-label { font-size:11px; text-transform:uppercase; letter-spacing:.14em; font-weight:700; margin-bottom:11px; display:flex; align-items:center; gap:8px; }
.bn .vsd .vsd-tick { width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-size:11px; line-height:1; }
.bn .vsd .good .vsd-tick { background:var(--ok); }
.bn .vsd .bad .vsd-tick { background:var(--NO); }
.bn .vsd .mini { background:#fff; border:1.5px solid var(--ink); border-radius:5px; overflow:hidden; }
.bn .vsd .mini .mini-head { padding:9px 14px; border-bottom:2px solid #14110C; font-family:Georgia,serif; font-weight:700; font-size:14px; color:#14110C; }
.bn .vsd .mini .mini-body { padding:12px 14px; position:relative; color:#14110C; }
.bn .vsd .mini .mini-tag { font-size:8px; text-transform:uppercase; letter-spacing:.16em; font-weight:700; color:var(--ink-mute); border:1px solid var(--hair); padding:3px 7px; border-radius:2px; background:#f4f0e6; display:inline-block; }
.bn .vsd .mini .mini-photo { height:90px; border-radius:2px; margin:10px 0; background:radial-gradient(120% 120% at 80% 0%,#9fb0bd,#6c8090 45%,#38454f); }
.bn .vsd .mini h4 { margin:0 0 8px; font-family:Georgia,serif; font-size:15px; line-height:1.12; font-weight:700; }
.bn .vsd .mini i { display:block; height:6px; border-radius:3px; background:rgba(20,17,12,.12); margin-bottom:7px; }
.bn .vsd .mini i.s { width:55%; }
.bn .vsd .ad { background:repeating-linear-gradient(45deg,#d8d2c2,#d8d2c2 10px,#cfc8b5 10px,#cfc8b5 20px); border:1px dashed #9a917a; display:flex; align-items:center; justify-content:center; font-size:8px; text-transform:uppercase; letter-spacing:.14em; color:var(--ink-mute); font-weight:700; position:relative; }
.bn .vsd .ad .adlbl { position:absolute; top:4px; right:5px; font-size:7px; background:rgba(20,17,12,.6); color:#fff; padding:1px 5px; border-radius:2px; }
.bn .vsd .popup { position:absolute; inset:auto 16px 14px 16px; background:#fff; border:1.5px solid var(--ink); border-radius:4px; padding:12px; box-shadow:0 12px 28px -10px rgba(20,17,12,.5); text-align:center; }
.bn .vsd .popup .x { position:absolute; top:4px; right:7px; font-size:11px; color:var(--ink-mute); }
.bn .vsd .popup strong { display:block; font-size:12px; margin-bottom:7px; }
.bn .vsd .popup .pbtn { display:inline-block; font-size:9px; text-transform:uppercase; letter-spacing:.1em; font-weight:700; background:var(--NO); color:#fff; padding:6px 13px; border-radius:3px; }
.bn .vsd-caption { font-size:11px; text-transform:uppercase; letter-spacing:.14em; color:var(--ink-mute); font-weight:600; margin:0 0 clamp(28px,3vw,40px); }

/* golden rule grain + excerpt */
.bn .rule { position:relative; overflow:hidden; }
.bn .rule::before { content:""; position:absolute; inset:0; background-image:var(--bn-grain); opacity:.06; pointer-events:none; }
.bn .rule .wrap { position:relative; z-index:1; }
.bn .rule-excerpt { background:rgba(237,232,219,.06); border-left:2px solid var(--paper); padding:18px 22px; border-radius:0 3px 3px 0; margin-top:24px; }
.bn .rule-excerpt .re-tag { font-size:8.5px; text-transform:uppercase; letter-spacing:.16em; color:rgba(237,232,219,.55); font-weight:700; margin-bottom:10px; }
.bn .rule-excerpt p { margin:0; font-family:Georgia,serif; font-size:15px; line-height:1.6; color:rgba(237,232,219,.92); }
.bn .rule-excerpt p .re-cap { font-size:34px; float:left; line-height:.8; margin:4px 9px 0 0; font-weight:700; color:var(--paper); }

/* brief -> quote */
.bn .bq-flow { display:grid; grid-template-columns:1fr auto 1fr; gap:20px; align-items:center; margin-top:clamp(36px,4vw,56px); }
.bn .bq-flow .bq-arrow { font-size:24px; color:var(--ink-mute); }
.bn .bq-panel { background:#fff; border:1.5px solid var(--ink); border-radius:6px; padding:18px; box-shadow:0 14px 32px -22px rgba(20,17,12,.5); }
.bn .bq-panel .bq-title { font-size:10px; text-transform:uppercase; letter-spacing:.14em; font-weight:700; color:var(--ink-mute); margin-bottom:14px; }
.bn .bq-field { margin-bottom:11px; }
.bn .bq-field .l { display:block; font-size:8.5px; text-transform:uppercase; letter-spacing:.12em; color:var(--ink-mute); font-weight:700; margin-bottom:4px; }
.bn .bq-field .v { min-height:26px; border:1.5px solid var(--hair); border-radius:3px; background:#faf8f1; display:flex; align-items:center; padding:6px 9px; font-size:11px; color:var(--ink-soft); }
.bn .bq-row2 { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
.bn .bq-badge { display:inline-block; font-size:8px; text-transform:uppercase; letter-spacing:.14em; font-weight:700; background:var(--ok); color:#fff; padding:3px 8px; border-radius:2px; margin-bottom:12px; }
.bn .bq-qrow { display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid var(--hair); font-size:12px; }
.bn .bq-qrow .qt { font-weight:600; color:var(--ink); }
.bn .bq-qrow .qm { font-size:9px; text-transform:uppercase; letter-spacing:.1em; color:var(--ink-mute); }
.bn .bq-qrow .qp { font-weight:700; font-variant-numeric:tabular-nums; color:var(--ink); }
.bn .bq-total { display:flex; justify-content:space-between; margin-top:12px; padding-top:12px; border-top:2px solid var(--ink); font-weight:700; font-size:14px; }

@media (max-width: 860px) {
  .bn .vsd { grid-template-columns:1fr; }
  .bn .bq-flow { grid-template-columns:1fr; }
  .bn .bq-flow .bq-arrow { transform:rotate(90deg); justify-self:center; }
}
```

- [ ] **Step 4: Tweak the publisher-strip logo to a calm single tone**

In `src/app/landing-styles.ts`, find the existing rule:

```css
.pub-strip-logo{height:26px;width:auto;opacity:.8}
```

Replace it with:

```css
.pub-strip-logo{height:26px;width:auto;opacity:.7;filter:grayscale(1) contrast(1.05)}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec tsx --test src/lib/marketing/preview-assets.test.ts 2>&1 | tail -20`
Expected: all three tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/landing-styles.ts src/lib/marketing/preview-assets.test.ts
git commit -m "feat(landing): visual-mock CSS + monochrome publisher logos

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: HeroArticleMock component + wire into hero

**Files:**
- Create: `src/app/[locale]/(marketing)/_components/HeroArticleMock.tsx`
- Modify: `src/app/[locale]/(marketing)/page.tsx` (import + slot in hero)

- [ ] **Step 1: Create the component**

Create `src/app/[locale]/(marketing)/_components/HeroArticleMock.tsx`:

```tsx
import { getTranslations } from "next-intl/server";

export async function HeroArticleMock({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" });
  return (
    <div className="na-frame" aria-hidden="true">
      <div className="na-bar">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
        <span className="url">{t("preview.mastheadName").toLowerCase()}.example/sponset</span>
      </div>
      <div className="na-masthead">
        <span className="na-name">{t("preview.mastheadName")}</span>
        <span className="na-nav">
          <span>{t("preview.heroNav1")}</span>
          <span>{t("preview.heroNav2")}</span>
          <span>{t("preview.heroNav3")}</span>
        </span>
      </div>
      <div className="na-art">
        <span className="na-tag">● {t("preview.heroTag")}</span>
        <h3>{t("preview.heroHeadline")}</h3>
        <p className="na-standfirst">{t("preview.heroStandfirst")}</p>
        <div className="na-byline">{t("preview.heroByline")}</div>
        <div className="na-photo" />
        <div className="na-cols">
          <i className="f" />
          <i />
          <i />
          <i className="s" />
          <i />
          <i />
          <i className="s" />
          <i />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Import it in page.tsx**

In `src/app/[locale]/(marketing)/page.tsx`, after the existing import on line 10 (`import { PublisherStrip } ...`), add:

```tsx
import { HeroArticleMock } from "./_components/HeroArticleMock";
```

- [ ] **Step 3: Slot it into the hero**

In `page.tsx`, inside the hero `<div className="wrap">`, immediately **after** the `</div>` that closes `hero-cluster` (currently line 151) and **before** the closing `</div>` of `.wrap`, add:

```tsx
          <div className="hero-showcase">
            <HeroArticleMock locale={locale} />
          </div>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -i "HeroArticleMock\|page.tsx" || echo "no type errors in touched files"`
Expected: `no type errors in touched files`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(marketing)/_components/HeroArticleMock.tsx" "src/app/[locale]/(marketing)/page.tsx"
git commit -m "feat(landing): hero native-article mock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: NativeVsDisplay component + wire above the vs-table

**Files:**
- Create: `src/app/[locale]/(marketing)/_components/NativeVsDisplay.tsx`
- Modify: `src/app/[locale]/(marketing)/page.tsx`

- [ ] **Step 1: Create the component**

Create `src/app/[locale]/(marketing)/_components/NativeVsDisplay.tsx`:

```tsx
import { getTranslations } from "next-intl/server";

export async function NativeVsDisplay({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" });
  return (
    <>
      <div className="vsd" aria-hidden="true">
        <div className="vsd-col good">
          <div className="vsd-label">
            <span className="vsd-tick">✓</span> {t("preview.vsNativeLabel")}
          </div>
          <div className="mini">
            <div className="mini-head">{t("preview.mastheadName")}</div>
            <div className="mini-body">
              <span className="mini-tag">● {t("preview.heroTag")}</span>
              <div className="mini-photo" />
              <h4>{t("preview.vsNativeHeadline")}</h4>
              <i />
              <i />
              <i className="s" />
            </div>
          </div>
        </div>
        <div className="vsd-col bad">
          <div className="vsd-label">
            <span className="vsd-tick">✕</span> {t("preview.vsDisplayLabel")}
          </div>
          <div className="mini">
            <div className="ad" style={{ height: 38 }}>
              {t("preview.vsAdLeaderboard")}
              <span className="adlbl">{t("preview.vsAdTag")}</span>
            </div>
            <div className="mini-head">{t("preview.vsDisplayName")}</div>
            <div className="mini-body">
              <div
                className="ad"
                style={{ height: 54, width: 110, float: "right", margin: "0 0 8px 10px" }}
              >
                {t("preview.vsAdBox")}
                <span className="adlbl">{t("preview.vsAdTag")}</span>
              </div>
              <h4>{t("preview.vsDisplayHeadline")}</h4>
              <i />
              <i />
              <i className="s" />
              <div className="ad" style={{ height: 28, margin: "10px 0" }}>
                {t("preview.vsAdInContent")}
                <span className="adlbl">{t("preview.vsAdTag")}</span>
              </div>
              <i />
              <i className="s" />
              <div className="popup">
                <span className="x">✕</span>
                <strong>{t("preview.vsPopupTitle")}</strong>
                <span className="pbtn">{t("preview.vsPopupCta")}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="vsd-caption">{t("preview.vsCaption")}</p>
    </>
  );
}
```

- [ ] **Step 2: Import it in page.tsx**

After the `HeroArticleMock` import, add:

```tsx
import { NativeVsDisplay } from "./_components/NativeVsDisplay";
```

- [ ] **Step 3: Slot it into the vs section**

In `page.tsx`, inside `<section className="vs">` → `<div className="wrap">`, immediately **after** the `</div>` that closes `vs-head` (currently line 198) and **before** `<table className="vs-table" ...>`, add:

```tsx
          <NativeVsDisplay locale={locale} />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -i "NativeVsDisplay\|page.tsx" || echo "no type errors in touched files"`
Expected: `no type errors in touched files`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(marketing)/_components/NativeVsDisplay.tsx" "src/app/[locale]/(marketing)/page.tsx"
git commit -m "feat(landing): native-vs-display side-by-side

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: GoldenRuleExcerpt component + wire into the rule section

**Files:**
- Create: `src/app/[locale]/(marketing)/_components/GoldenRuleExcerpt.tsx`
- Modify: `src/app/[locale]/(marketing)/page.tsx`

- [ ] **Step 1: Create the component**

Create `src/app/[locale]/(marketing)/_components/GoldenRuleExcerpt.tsx`:

```tsx
import { getTranslations } from "next-intl/server";

export async function GoldenRuleExcerpt({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" });
  return (
    <div className="rule-excerpt" aria-hidden="true">
      <div className="re-tag">{t("preview.ruleExcerptTag")}</div>
      <p>
        <span className="re-cap">{t("preview.ruleExcerptCap")}</span>
        {t("preview.ruleExcerptBody")}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Import it in page.tsx**

After the `NativeVsDisplay` import, add:

```tsx
import { GoldenRuleExcerpt } from "./_components/GoldenRuleExcerpt";
```

- [ ] **Step 3: Slot it into the rule section**

In `page.tsx`, inside `<section className="rule">` → `<div className="wrap">`, the second `<div>` contains `<p className="body">…</p>` and `<div className="sig">…</div>`. Immediately **after** the `<div className="sig">…</div>` line (currently line 239) and before that `<div>`'s closing tag, add:

```tsx
            <GoldenRuleExcerpt locale={locale} />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -i "GoldenRuleExcerpt\|page.tsx" || echo "no type errors in touched files"`
Expected: `no type errors in touched files`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(marketing)/_components/GoldenRuleExcerpt.tsx" "src/app/[locale]/(marketing)/page.tsx"
git commit -m "feat(landing): golden-rule print excerpt + grain

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: BriefToQuote component + wire into the how section

**Files:**
- Create: `src/app/[locale]/(marketing)/_components/BriefToQuote.tsx`
- Modify: `src/app/[locale]/(marketing)/page.tsx`

- [ ] **Step 1: Create the component**

Create `src/app/[locale]/(marketing)/_components/BriefToQuote.tsx`:

```tsx
import { getTranslations } from "next-intl/server";

export async function BriefToQuote({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" });
  return (
    <div className="bq-flow" aria-hidden="true">
      <div className="bq-panel">
        <div className="bq-title">{t("preview.briefTitle")}</div>
        <div className="bq-field">
          <span className="l">{t("preview.briefObjLabel")}</span>
          <div className="v">{t("preview.briefObjValue")}</div>
        </div>
        <div className="bq-row2">
          <div className="bq-field">
            <span className="l">{t("preview.briefMarketsLabel")}</span>
            <div className="v">{t("preview.briefMarketsValue")}</div>
          </div>
          <div className="bq-field">
            <span className="l">{t("preview.briefBudgetLabel")}</span>
            <div className="v">{t("preview.briefBudgetValue")}</div>
          </div>
        </div>
        <div className="bq-field">
          <span className="l">{t("preview.briefDatesLabel")}</span>
          <div className="v">{t("preview.briefDatesValue")}</div>
        </div>
      </div>
      <div className="bq-arrow">→</div>
      <div className="bq-panel">
        <div className="bq-title">{t("preview.quoteTitle")}</div>
        <span className="bq-badge">● {t("preview.quoteBadge")}</span>
        {([1, 2, 3] as const).map((n) => (
          <div className="bq-qrow" key={n}>
            <span>
              <span className="qt">{t(`preview.quoteR${n}Title`)}</span>
              <br />
              <span className="qm">{t(`preview.quoteR${n}Meta`)}</span>
            </span>
            <span className="qp">{t(`preview.quoteR${n}Price`)}</span>
          </div>
        ))}
        <div className="bq-total">
          <span>{t("preview.quoteTotalLabel")}</span>
          <span>{t("preview.quoteTotalValue")}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Import it in page.tsx**

After the `GoldenRuleExcerpt` import, add:

```tsx
import { BriefToQuote } from "./_components/BriefToQuote";
```

- [ ] **Step 3: Slot it into the how section**

In `page.tsx`, inside `<section className="how" id="how">` → `<div className="wrap">`, immediately **after** the `</div>` that closes `how-cols` (currently line 405) and before the closing `</div>` of `.wrap`, add:

```tsx
          <BriefToQuote locale={locale} />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -i "BriefToQuote\|page.tsx" || echo "no type errors in touched files"`
Expected: `no type errors in touched files`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(marketing)/_components/BriefToQuote.tsx" "src/app/[locale]/(marketing)/page.tsx"
git commit -m "feat(landing): brief-to-quote product mock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `pnpm test 2>&1 | tail -25`
Expected: all tests pass, including the three in `preview-assets.test.ts`. No failures introduced elsewhere.

- [ ] **Step 2: Lint**

Run: `pnpm lint 2>&1 | tail -25`
Expected: no new errors in the touched files. (Note `PublisherStrip.tsx` already disables `@next/next/no-img-element`; the new components use no `<img>`.)

- [ ] **Step 3: Production build**

Run: `pnpm build 2>&1 | tail -30`
Expected: build succeeds (compiles the landing route with the four new components).

- [ ] **Step 4: Manual visual check**

Start the dev server on the project's configured port (NOT 3000 — read it from `package.json`'s `dev` script or `.env`). Open the landing page at `/en` and confirm, in order: hero shows the article mock; "Two formats" shows the side-by-side above the table; the dark Golden Rule has faint grain + the drop-cap excerpt; "How buying works" shows brief→quote; the publisher strip logos render in a calm single tone. Resize below 860px and confirm the vs-display and brief→quote stack vertically.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/landing-visual-sections
gh pr create --title "feat(landing): visual showcase sections (increment 1)" --body "$(cat <<'EOF'
Adds five pure-CSS visual sections to the marketing landing page so it shows the product, not just describes it: hero native-article mock, native-vs-display, golden-rule print excerpt, brief→quote, and monochrome publisher logos.

- Generic fictional masthead only (no third-party trademarks).
- English-first copy in a new `preview` i18n section; no/sv/da/de/fi stubbed from English (translation is a follow-up).
- Contract tests for i18n key parity + CSS presence; build + manual visual verified.
- Covers and the interactive "preview your own native ad" tool are deferred (increment 2).

Spec: docs/superpowers/specs/2026-06-08-landing-visual-sections-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened against `main`. Do not merge until reviewed (merge auto-deploys to prod).

---

## Self-review notes (resolved during planning)

- **Spec coverage:** all five visuals → Tasks 3–6 + Task 2 (publisher polish); i18n English-first + stubs → Task 1; CSS in `landing-styles.ts` namespaced `.bn` → Task 2; generic masthead via single `preview.mastheadName` key → used in Tasks 3–4; branch+PR → Task 7. Covers + interactive tool explicitly deferred (not in this plan).
- **Type consistency:** every component is `({ locale }: { locale: string })` and reads `t("preview.*")`; all referenced keys exist in the Task 1 JSON and the Task 1 test's required list.
- **Placeholder scan:** no TBD/TODO; every code/CSS/JSON block is complete and copy-pasteable.
