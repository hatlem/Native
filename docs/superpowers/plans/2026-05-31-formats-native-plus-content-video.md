# Native Plus + Content Video Formats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two buyable (RFQ-requestable) product formats — Native Plus (shoppable) and Content Video — across the data model, marketing pages, catalog filter, desk drafting, and a new creative-prep guide, in all six locales.

**Architecture:** Two new `ProductType` enum values + four nullable `Spec` columns, surfaced through the existing format-list/marketing wiring. The homepage's `Record<ProductType,string>` map makes a missed consumer a hard TypeScript error — that's the primary safety net. New formats are RFQ-only: NOT auto-created by the activation blueprint and NOT seeded (no fake priced inventory).

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, next-intl (per-namespace JSON), zod. Tests: `node:test` (NOT Vitest). Marketing CSS is plain classes in `src/app/landing-styles.ts`.

**Branch:** `feat/formats-native-plus-video` (already created off `feat/trust-and-capture`; do NOT switch). The spec lives at `docs/superpowers/specs/2026-05-30-formats-native-plus-content-video-design.md`.

**Conventions verified in this repo (do not deviate):**
- `prisma migrate dev`/`reset` are BLOCKED for the agent. Hand-author migration SQL under `prisma/migrations/<ts>_name/migration.sql`, then reconcile dev with `prisma db execute` + `prisma migrate resolve --applied`, then `prisma generate`. Migration dir names sort lexicographically; new one must sort AFTER `20260530160000_add_subscriber_and_publisher_logo`.
- Repo precedent for enum extension + column add in one file: `prisma/migrations/20260526210000_order_cancellation_and_editorial_veto/migration.sql` (uses `ALTER TYPE ... ADD VALUE IF NOT EXISTS` alongside `ALTER TABLE ... ADD COLUMN`). Mirror that exactly.
- Commands: `pnpm typecheck`, `pnpm build`, `pnpm test`.
- i18n namespaces: `formats` and `productType` are ROOT namespaces in `src/messages/{locale}.json`. `landing.catalog.*` lives in `src/messages/landing/{locale}/catalog.json` (the landing folder, not root). Locales: en, no, sv, da, fi, de.

---

## File Structure

**Schema / data:**
- `prisma/schema.prisma` — `ProductType` (+2 values), `Spec` (+4 nullable columns).
- `prisma/migrations/20260531120000_add_native_plus_content_video/migration.sql` — new.

**Explicit-list consumers (must extend; auto-handling consumers untouched):**
- `src/app/[locale]/(marketing)/formats/page.tsx` — `Slug` union + `FORMATS` array.
- `src/app/[locale]/(marketing)/page.tsx` — `PRODUCT_TYPE_TO_FORMAT_KEY`.
- `src/app/[locale]/(marketing)/for-advertisers/page.tsx` — `FORMAT_KEYS`.
- `src/app/[locale]/catalog/page.tsx` — `FORMAT_KEYS` (format filter).
- `src/app/[locale]/price-request/[token]/page.tsx` — draft-type `<option>`s.

**Deliberately NOT changed (RFQ-only):**
- `src/lib/activation-blueprint.ts`, `prisma/seed.ts` — add a one-line comment noting the exclusion; no new product types auto-created/seeded.

**i18n:**
- `src/messages/{en,no,sv,da,fi,de}.json` — `productType` keys; `formats` new slug blocks + backfilled `title`/`rule`/`th`; new `creativeSpecs` namespace.
- `src/messages/landing/{en,no,sv,da,fi,de}/catalog.json` — `fmtNativePlus`, `fmtContentVideo`.

**Creative-prep guide:**
- `src/app/[locale]/(marketing)/resources/creative-specs/page.tsx` — new page.
- `src/app/landing-shell.tsx` — footer link.
- `src/app/[locale]/(marketing)/formats/page.tsx` — "How to prepare" link.

---

## Task 1: Schema — enum values + Spec columns + migration

**Files:**
- Modify: `prisma/schema.prisma` (ProductType ~line 37-44; Spec ~line 391-403)
- Create: `prisma/migrations/20260531120000_add_native_plus_content_video/migration.sql`

- [ ] **Step 1: Extend the `ProductType` enum.** Change the enum block to:

```prisma
enum ProductType {
  NATIVE_ARTICLE
  ADVERTORIAL
  NATIVE_DISPLAY
  PACKAGE
  CONTEXTUAL
  OTHER
  // Shoppable native article — in-article product links / buy buttons.
  NATIVE_PLUS
  // Video-led sponsored placement in the publisher's player/feed.
  CONTENT_VIDEO
}
```

- [ ] **Step 2: Add the four nullable `Spec` columns.** In `model Spec`, after the `requirements` line, add:

```prisma
  // Content Video specs (null for non-video formats).
  videoMaxSeconds Int?    // max length in seconds, e.g. 60
  videoHosting    String? // accepted hosting/format, e.g. "YouTube, Vimeo, or MP4 ≤ 200 MB"
  // Native Plus (shoppable) specs (null for non-shoppable formats).
  shoppableMaxProducts Int?    // max in-article product links/cards, e.g. 3
  ctaGuidance          String? // allowed/required buy-button CTA wording
```

- [ ] **Step 3: Write the migration SQL.** Create `prisma/migrations/20260531120000_add_native_plus_content_video/migration.sql`:

```sql
-- New product formats: Native Plus (shoppable) + Content Video.
-- ALTER TYPE ... ADD VALUE coexists with unrelated ADD COLUMN in one file
-- (see 20260526210000_order_cancellation_and_editorial_veto) because nothing
-- here inserts rows using the new enum values.

-- AlterEnum: ProductType
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'NATIVE_PLUS';
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'CONTENT_VIDEO';

-- AlterTable: Spec
ALTER TABLE "Spec"
  ADD COLUMN IF NOT EXISTS "videoMaxSeconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "videoHosting" TEXT,
  ADD COLUMN IF NOT EXISTS "shoppableMaxProducts" INTEGER,
  ADD COLUMN IF NOT EXISTS "ctaGuidance" TEXT;
```

- [ ] **Step 4: Apply the migration to the dev DB without `migrate dev`.** Run each:

```bash
pnpm prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260531120000_add_native_plus_content_video/migration.sql
pnpm prisma migrate resolve --applied 20260531120000_add_native_plus_content_video
pnpm prisma generate
```

Expected: db execute "Script executed successfully"; resolve "marked as applied"; generate succeeds.

- [ ] **Step 5: Verify migrate status + client.**

Run: `pnpm prisma migrate status`
Expected: "Database schema is up to date!"

Run: `pnpm typecheck`
Expected: PASS for schema-derived types (the only pre-existing error is in the untracked `src/lib/content-fee.it.test.ts` — ignore it; confirm no NEW errors). Note: after this step the marketing files will have a NEW typecheck error because `PRODUCT_TYPE_TO_FORMAT_KEY` (a `Record<ProductType,string>`) is now missing the two new keys — that is expected and is fixed in Task 2. If you see ONLY that error (in `(marketing)/page.tsx`) plus the content-fee one, proceed.

- [ ] **Step 6: Commit.**

```bash
git add prisma/schema.prisma prisma/migrations/20260531120000_add_native_plus_content_video
git commit -m "feat(formats): add NATIVE_PLUS + CONTENT_VIDEO enum and Spec columns"
```

---

## Task 2: Extend the explicit-list consumers

Five files enumerate the format set by hand. Extending them all in one task keeps the build green between commits.

**Files:**
- Modify: `src/app/[locale]/(marketing)/formats/page.tsx:17-24`
- Modify: `src/app/[locale]/(marketing)/page.tsx:20-27`
- Modify: `src/app/[locale]/(marketing)/for-advertisers/page.tsx:8-13`
- Modify: `src/app/[locale]/catalog/page.tsx:23-28`
- Modify: `src/app/[locale]/price-request/[token]/page.tsx:85-90`
- Modify: `src/lib/activation-blueprint.ts` + `prisma/seed.ts` (comment only)

- [ ] **Step 1: `formats/page.tsx` — extend the `Slug` union and `FORMATS` array.** Replace lines 17-24:

```tsx
type Slug = "native-article" | "advertorial" | "native-display" | "package" | "native-plus" | "content-video";

const FORMATS: { slug: Slug; type: ProductType; key: string }[] = [
  { slug: "native-article", type: ProductType.NATIVE_ARTICLE, key: "NATIVE_ARTICLE" },
  { slug: "advertorial", type: ProductType.ADVERTORIAL, key: "ADVERTORIAL" },
  { slug: "native-display", type: ProductType.NATIVE_DISPLAY, key: "NATIVE_DISPLAY" },
  { slug: "package", type: ProductType.PACKAGE, key: "PACKAGE" },
  { slug: "native-plus", type: ProductType.NATIVE_PLUS, key: "NATIVE_PLUS" },
  { slug: "content-video", type: ProductType.CONTENT_VIDEO, key: "CONTENT_VIDEO" },
];
```

- [ ] **Step 2: `(marketing)/page.tsx` — extend `PRODUCT_TYPE_TO_FORMAT_KEY`.** The map currently ends:

```tsx
  [ProductType.CONTEXTUAL]: "fmtSponsoredContent",
  [ProductType.OTHER]: "fmtSponsoredContent",
};
```

Replace that closing with the two new entries added before the brace:

```tsx
  [ProductType.CONTEXTUAL]: "fmtSponsoredContent",
  [ProductType.OTHER]: "fmtSponsoredContent",
  [ProductType.NATIVE_PLUS]: "fmtNativePlus",
  [ProductType.CONTENT_VIDEO]: "fmtContentVideo",
};
```

- [ ] **Step 3: `for-advertisers/page.tsx` — extend `FORMAT_KEYS`.** Replace lines 8-13:

```tsx
const FORMAT_KEYS: ProductType[] = [
  ProductType.NATIVE_ARTICLE,
  ProductType.ADVERTORIAL,
  ProductType.NATIVE_DISPLAY,
  ProductType.PACKAGE,
  ProductType.NATIVE_PLUS,
  ProductType.CONTENT_VIDEO,
];
```

- [ ] **Step 4: `catalog/page.tsx` — extend the format-filter `FORMAT_KEYS`.** Replace the block at lines 23-28 (keep the comment above it, but update it):

```tsx
// Marketing/catalog surface highlights the buyable formats — research-only
// enum members (CONTEXTUAL, OTHER) intentionally don't show in the filter.
const FORMAT_KEYS: ProductType[] = [
  ProductType.NATIVE_ARTICLE,
  ProductType.ADVERTORIAL,
  ProductType.NATIVE_DISPLAY,
  ProductType.PACKAGE,
  ProductType.NATIVE_PLUS,
  ProductType.CONTENT_VIDEO,
];
```

- [ ] **Step 5: `price-request/[token]/page.tsx` — add two draft `<option>`s.** After the `PACKAGE` option (line 89) and before `OTHER`, insert:

```tsx
                    <option value="NATIVE_PLUS">Native Plus</option>
                    <option value="CONTENT_VIDEO">Content video</option>
```

- [ ] **Step 6: Document the deliberate RFQ-only exclusion.** In `src/lib/activation-blueprint.ts`, find the `BASELINE` array of product types and add a comment directly above it:

```ts
// NATIVE_PLUS and CONTENT_VIDEO are intentionally excluded: they are
// RFQ-only formats with no auto-created priced inventory (see
// docs/superpowers/specs/2026-05-30-formats-native-plus-content-video-design.md).
```

And in `prisma/seed.ts`, above the product-blueprint seeding block, add:

```ts
// Note: NATIVE_PLUS / CONTENT_VIDEO are RFQ-only and intentionally not seeded.
```

- [ ] **Step 7: Verify build (catches the exhaustive map + missing i18n).**

Run: `pnpm typecheck`
Expected: PASS — no error in `(marketing)/page.tsx` anymore (map is now exhaustive). Only the pre-existing `content-fee.it.test.ts` error may remain.

Run: `pnpm build`
Expected: "Compiled successfully". (The new i18n keys don't exist yet, but next-intl renders missing keys as key-paths without failing the build — Task 3 fills them.)

- [ ] **Step 8: Commit.**

```bash
git add "src/app/[locale]/(marketing)/formats/page.tsx" "src/app/[locale]/(marketing)/page.tsx" "src/app/[locale]/(marketing)/for-advertisers/page.tsx" "src/app/[locale]/catalog/page.tsx" "src/app/[locale]/price-request/[token]/page.tsx" src/lib/activation-blueprint.ts prisma/seed.ts
git commit -m "feat(formats): surface Native Plus + Content Video across format consumers"
```

---

## Task 3: i18n — productType, formats blocks, catalog labels

Adds the new format copy. NOTE (verified): the `formats` namespace already has a complete `th` comparison-header block and the four existing slug blocks already have `title/voice/brand/reads/bestFor/rule` in all six locales — do NOT touch or "backfill" them. This task ONLY adds: two `productType` entries (+desc), two new `formats` slug blocks (`native-plus`, `content-video`), and two `landing.catalog.fmt*` labels.

**Files:**
- Modify: `src/messages/en.json` (`productType`, `formats`)
- Modify: `src/messages/{no,sv,da,fi,de}.json` (same)
- Modify: `src/messages/landing/{en,no,sv,da,fi,de}/catalog.json`

- [ ] **Step 1: English `productType` keys.** In `src/messages/en.json`, in the `productType` object, add (after `descOTHER`, before `CONTENT_FEE`):

```json
    "NATIVE_PLUS": "Native Plus",
    "CONTENT_VIDEO": "Content video",
    "descNATIVE_PLUS": "Shoppable native article — editorial-grade copy with in-article product links and buy buttons, so readers can act without leaving the page.",
    "descCONTENT_VIDEO": "Video-led sponsored placement that runs in the publisher's player and feed, built for attention rather than a banner slot.",
```

- [ ] **Step 2: English `formats` — two NEW slug blocks only.** In `src/messages/en.json`, in the `formats` object, add these two blocks alongside the existing `package` block (do NOT modify `th` or the four existing slug blocks — they already exist and render correctly). Match the existing blocks' shape (title, voice, brand, reads, bestFor, rule) and punchy voice:

```json
    "native-plus": {
      "title": "Inspiration you can act on.",
      "voice": "The title's editorial voice, with shoppable moments built in",
      "brand": "Named advertiser; products clearly marked as buyable",
      "reads": "A feature you can act on — tap a product, not a banner",
      "bestFor": "Considered products where inspiration and purchase belong together",
      "rule": "Commerce is additive, never the disguise — the story still earns the read."
    },
    "content-video": {
      "title": "Video that earns the play.",
      "voice": "Video in the title's register, not a TV spot",
      "brand": "Named advertiser; disclosed as paid in the player",
      "reads": "The publisher's own video, in-feed and in-player",
      "bestFor": "Stories better shown than told — demos, places, people",
      "rule": "Earns the view on its own merit; the disclosure is always visible."
    }
```

- [ ] **Step 3: English catalog labels.** In `src/messages/landing/en/catalog.json`, add:

```json
  "fmtNativePlus": "Native Plus",
  "fmtContentVideo": "Content video",
```

- [ ] **Step 4: Translate Steps 1–3 into no, sv, da, fi, de.** For each locale file `src/messages/<loc>.json` (the two new `productType` entries +desc, and the two new `formats` slug blocks) and `src/messages/landing/<loc>/catalog.json` (the two fmt keys), add the SAME keys with natural, native-quality copy (no literal calques — per the translation-quality rule). Keep industry terms: `native-annonsering`/`native` (no/sv), `native-annoncering` (da), `natiivimainonta` (fi), German "Native Advertising"/"Content-Video". `productType.CONTENT_VIDEO` → no: "Innholdsvideo", sv: "Innehållsvideo", da: "Indholdsvideo", fi: "Sisältövideo", de: "Content-Video". "Native Plus" stays "Native Plus" everywhere (product name). Do NOT touch the existing four slug blocks or `th` — they are already translated.

- [ ] **Step 5: Validate JSON + key parity.** Run:

```bash
node -e '
const fs=require("fs"); const locales=["en","no","sv","da","fi","de"];
for (const l of locales) { JSON.parse(fs.readFileSync(`src/messages/${l}.json`,"utf8")); JSON.parse(fs.readFileSync(`src/messages/landing/${l}/catalog.json`,"utf8")); }
const ptRef=Object.keys(JSON.parse(fs.readFileSync("src/messages/en.json","utf8")).productType).sort();
for (const l of locales) { const k=Object.keys(JSON.parse(fs.readFileSync(`src/messages/${l}.json`,"utf8")).productType).sort(); if(JSON.stringify(k)!==JSON.stringify(ptRef)) console.log("productType DRIFT",l); }
for (const key of ["NATIVE_PLUS","CONTENT_VIDEO","descNATIVE_PLUS","descCONTENT_VIDEO"]) for (const l of locales) { if(!JSON.parse(fs.readFileSync(`src/messages/${l}.json`,"utf8")).productType[key]) console.log("MISSING",l,key); }
for (const l of locales) { const c=JSON.parse(fs.readFileSync(`src/messages/landing/${l}/catalog.json`,"utf8")); if(!c.fmtNativePlus||!c.fmtContentVideo) console.log("catalog MISSING",l); }
console.log("i18n parity check done");
'
```

Expected: only "i18n parity check done" (no DRIFT/MISSING lines).

- [ ] **Step 6: Build.**

Run: `pnpm build`
Expected: "Compiled successfully", no missing-message warnings for the new keys.

- [ ] **Step 7: Commit.**

```bash
git add src/messages
git commit -m "feat(formats): i18n for Native Plus + Content Video (six locales) + format backfill"
```

---

## Task 4: Creative-prep guide page (`/resources/creative-specs`)

**Files:**
- Create: `src/app/[locale]/(marketing)/resources/creative-specs/page.tsx`
- Modify: `src/messages/{en,no,sv,da,fi,de}.json` (new `creativeSpecs` namespace)
- Modify: `src/app/landing-shell.tsx` (footer link)
- Modify: `src/app/[locale]/(marketing)/formats/page.tsx` ("How to prepare" link)

- [ ] **Step 1: English `creativeSpecs` namespace.** In `src/messages/en.json`, add a top-level `creativeSpecs` object:

```json
  "creativeSpecs": {
    "metaTitle": "Creative specs — how to prepare your content",
    "eyebrow": "Creative specs",
    "title": "How to prepare your content",
    "lead": "What we need from you to get a placement live, by format. Bring these and the desk can move fast.",
    "article": {
      "heading": "Articles (Native Article, Advertorial, Native Plus)",
      "body": "500–800 words (shorter is fine with strong visuals). Images at least 1200×628 px, ideally under 300 KB. Headline up to 70 characters, teaser up to 200. Two to three external links. Allow 3 working days for your material, 10 if we write it."
    },
    "nativePlus": {
      "heading": "Native Plus — shoppable extras",
      "body": "Up to 3 in-article product links or cards. Each needs a product name, image, price, and destination URL. Keep buy-button wording short and honest (e.g. \"Shop now\", \"See the product\"). Products are clearly marked as advertising."
    },
    "video": {
      "heading": "Content video",
      "body": "Up to 60 seconds works best. Supply a YouTube or Vimeo link, or an MP4 up to roughly 200 MB. Include a thumbnail and a one-line teaser. Captions strongly recommended — most plays start muted."
    },
    "disclosureHeading": "Disclosure",
    "disclosureBody": "Every placement is clearly marked as paid in the market's required wording. The label is never hidden, shrunk, or removed.",
    "ctaTitle": "Ready to brief us?",
    "ctaBody": "Send what you have — we'll tell you what's missing.",
    "ctaContact": "Talk to the desk"
  },
```

- [ ] **Step 2: Create the page.** `src/app/[locale]/(marketing)/resources/creative-specs/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "creativeSpecs" });
  return { title: t("metaTitle"), description: t("lead") };
}

const SECTIONS = ["article", "nativePlus", "video"] as const;

export default async function CreativeSpecsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "creativeSpecs" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  return (
    <LandingShell locale={locale} screenLabel="Creative specs">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="grid">
            {SECTIONS.map((s) => (
              <article className="card" key={s}>
                <h2>{t(`${s}.heading`)}</h2>
                <p className="muted">{t(`${s}.body`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("disclosureHeading")}</h2>
          <p className="prose">{t("disclosureBody")}</p>
        </div>
      </section>

      <section className="cta-block">
        <div className="wrap">
          <h2>{t("ctaTitle")}</h2>
          <p>{t("ctaBody")}</p>
          <div className="hero-actions">
            <Link href="/contact" className="btn primary">
              {t("ctaContact")} <span className="arrow">→</span>
            </Link>
            <Link href="/signup" className="btn secondary">
              {tm("createAccount")}
            </Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
```

- [ ] **Step 3: Link from `/formats`.** In `src/app/[locale]/(marketing)/formats/page.tsx`, in the disclosure prose section (around the `disclosureBody` paragraph, before the CTA block), add a link paragraph:

```tsx
          <p className="prose">
            <Link href="/resources/creative-specs">{t("creativeSpecsLink")}</Link>
          </p>
```

Add the `creativeSpecsLink` key to the `formats` namespace in all six `src/messages/<loc>.json` (en: `"creativeSpecsLink": "How to prepare your content →"`; translate the rest). Ensure `Link` is imported in the page (it already is).

- [ ] **Step 4: Footer link.** In `src/app/landing-shell.tsx`, inside the `<nav aria-label="Footer">`, add after the existing links:

```tsx
              <Link href="/resources/creative-specs">{t("foot.navCreativeSpecs")}</Link>
```

Add `"navCreativeSpecs": "Creative specs"` (translated) to the `foot` namespace in each `src/messages/landing/<loc>/foot.json`.

- [ ] **Step 5: Translate the `creativeSpecs` namespace + the two new keys into no, sv, da, fi, de.** Same keys, natural native copy. Validate JSON parses for all six.

- [ ] **Step 6: Build + parity check.**

```bash
node -e '
const fs=require("fs"); const locales=["en","no","sv","da","fi","de"];
const ref=Object.keys(JSON.parse(fs.readFileSync("src/messages/en.json","utf8")).creativeSpecs).sort();
for (const l of locales){ const cs=JSON.parse(fs.readFileSync(`src/messages/${l}.json`,"utf8")).creativeSpecs; if(!cs){console.log("creativeSpecs MISSING",l);continue;} if(JSON.stringify(Object.keys(cs).sort())!==JSON.stringify(ref)) console.log("creativeSpecs DRIFT",l);
  const foot=JSON.parse(fs.readFileSync(`src/messages/landing/${l}/foot.json`,"utf8")); if(!foot.navCreativeSpecs) console.log("foot.navCreativeSpecs MISSING",l);
  const f=JSON.parse(fs.readFileSync(`src/messages/${l}.json`,"utf8")).formats; if(!f.creativeSpecsLink) console.log("formats.creativeSpecsLink MISSING",l);
}
console.log("creative-specs parity done");
'
```

Expected: only "creative-specs parity done".

Run: `pnpm build`
Expected: "Compiled successfully"; the `/resources/creative-specs` route appears for `[locale]`.

- [ ] **Step 7: Commit.**

```bash
git add "src/app/[locale]/(marketing)/resources" src/messages src/app/landing-shell.tsx "src/app/[locale]/(marketing)/formats/page.tsx"
git commit -m "feat(formats): creative-specs guide page + footer/formats links (six locales)"
```

---

## Task 5: Full verification

- [ ] **Step 1: Typecheck.**

Run: `pnpm typecheck`
Expected: no errors except the pre-existing untracked `src/lib/content-fee.it.test.ts`.

- [ ] **Step 2: Lint.**

Run: `pnpm lint`
Expected: PASS (fix any new warnings in touched files).

- [ ] **Step 3: Tests.**

Run: `pnpm test`
Expected: full suite passes (0 fail), same as before this sub-project.

- [ ] **Step 4: Build, all locales.**

Run: `pnpm build`
Expected: "Compiled successfully"; `/[locale]/resources/creative-specs` and the existing `/formats` route both present.

- [ ] **Step 5: Manual smoke (dev server on the project's configured port — NEVER 3000).**

Run `pnpm dev`, then in a browser:
1. `/en/formats` — six format cards render (incl. Native Plus, Content video) with real titles (no "content-video.title" key-paths), and the comparison table has real headers.
2. `/en/for-advertisers` — six formats listed.
3. `/en/catalog` — the format filter offers the two new formats.
4. `/en/resources/creative-specs` — renders the three spec sections + disclosure; footer "Creative specs" link works from any marketing page; "How to prepare" link works from `/formats`.
5. Spot-check `/no/formats` and `/de/resources/creative-specs` for translated copy (no English fallthrough, no key-paths).

- [ ] **Step 6: Final commit (only if smoke fixes were needed).**

```bash
git add -A
git commit -m "chore(formats): verification fixes"
```

---

## Self-Review notes

- **Spec coverage:** enum +2 (T1) ✓; structured Spec columns videoMaxSeconds/videoHosting/shoppableMaxProducts/ctaGuidance (T1) ✓; migration ordered + ADD VALUE precedent (T1) ✓; all explicit-list consumers extended (T2) ✓; activation-blueprint/seed exclusion documented, not auto-created (T2) ✓; canonical-6 on /formats, /for-advertisers, catalog filter (T2) ✓; productType + formats + landing.catalog i18n ×6 (T3) ✓; creative-specs page + namespace + links ×6 (T4) ✓; honest copy guardrails (T3/T4 copy) ✓; verification incl. TS exhaustiveness + parity + build (T1/T2/T3/T4/T5) ✓.
- **Verified, not assumed:** the `formats` namespace already has `th` and full `title/voice/brand/reads/bestFor/rule` blocks for the four existing formats in all six locales — T3 only ADDS the two new slug blocks + productType + catalog keys and does not touch existing copy.
- **Convention match:** migration applied via db execute + resolve (migrate dev blocked); node:test for any pure helper (none required here — all changes are data/config/markup, guarded by `tsc` exhaustiveness + build).
