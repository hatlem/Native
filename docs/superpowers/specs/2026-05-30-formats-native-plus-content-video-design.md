# New Formats: Native Plus + Content Video — Design Spec

**Date:** 2026-05-30
**Status:** Approved (design); pending spec review
**Sub-project:** 2 of 5 in the SUNT-gap competitive build

## Context

Competitor SUNT markets two formats NativeSpin lacks: **Native Plus**
(shoppable / in-article e-commerce conversion) and **Content Video**
(video-led sponsored placement). The product owner chose to *build them for
real* rather than market vapor.

Decisions locked during brainstorming:

- **Build depth:** RFQ-requestable. Add the two `ProductType` values; buyers can
  request them via the existing RFQ / price-request flow; desk can create
  products of these types; specs are documented. **No** pre-priced public
  inventory, **no** activation-blueprint auto-creation, **no** seeded sample
  products (avoids fake catalog rows / invented prices).
- **Spec fields:** add structured nullable columns (not just free-form).
- **Marketed set:** the two formats join the canonical marketed set (6) on
  `/formats`, `/for-advertisers`, and the catalog format filter.
- **Creative-prep guide:** a new `/resources/creative-specs` page documenting
  real specs per format.

## Grounding (current state, verified)

- `ProductType` enum: `prisma/schema.prisma:37-44` —
  NATIVE_ARTICLE, ADVERTORIAL, NATIVE_DISPLAY, PACKAGE, CONTEXTUAL, OTHER.
- `Spec` model: `prisma/schema.prisma:391` — wordCountMin/Max, imagesMin,
  disclosureLabel, fileFormats, requirements.
- **Auto-handling consumers** (use `Object.values(ProductType)`, need NO change):
  desk content-fees (`desk/content-fees/page.tsx`), desk playbooks
  (`desk/playbooks/page.tsx`), catalog filter parse (`catalog/page.tsx`),
  OpenAPI enum (`api/openapi.json/route.ts`), API catalog route
  (`api/v1/catalog/titles/route.ts`).
- **Explicit-list consumers** (MUST extend):
  - `formats/page.tsx:17-24` — `Slug` union + `FORMATS` array.
  - `(marketing)/page.tsx:18-25` — `PRODUCT_TYPE_TO_FORMAT_KEY: Record<ProductType,string>`
    (TS exhaustiveness will *force* the new keys — a compile error if missed).
  - `for-advertisers/page.tsx:8-13` — `FORMAT_KEYS: ProductType[]`.
  - `catalog/page.tsx:23-28` — `FORMAT_KEYS: ProductType[]` (format filter).
  - `price-request/[token]/page.tsx:85-90` — draft-type `<option>` list.
- **Deliberately NOT changed:** `activation-blueprint.ts` BASELINE and
  `prisma/seed.ts` — RFQ-only formats must not auto-create priced products.
  Add a one-line comment at each noting the exclusion.
- i18n: `productType` namespace lives in root `src/messages/{locale}.json`
  (keys: `<TYPE>` + `desc<TYPE>` + `CONTENT_FEE`). The `formats` page namespace
  and `landing.catalog.fmt*` labels also live there / in the landing structure.
  Locales: en, no, sv, da, fi, de. The rate-card publisher form
  (`RateCardForm.tsx`) keeps its own separate string list — unrelated to
  `ProductType`; out of scope.

## 1. Schema

Add to `ProductType` (after OTHER):

```prisma
  NATIVE_PLUS
  CONTENT_VIDEO
```

Add to `Spec` (all nullable; null for the four existing formats):

```prisma
  // Content Video specs
  videoMaxSeconds Int?    // max length, seconds (e.g. 60)
  videoHosting    String? // accepted hosting/format, e.g. "YouTube, Vimeo, or MP4 ≤ 200 MB"
  // Native Plus (shoppable) specs
  shoppableMaxProducts Int?    // max in-article product links/cards (e.g. 3)
  ctaGuidance          String? // allowed/required buy-button CTA wording
```

One additive migration: `ALTER TYPE "ProductType" ADD VALUE` for each (×2) +
`ALTER TABLE "Spec" ADD COLUMN` for each (×4). Hand-authored under
`prisma/migrations/<ts>_add_native_plus_content_video/` with a timestamp that
sorts after `20260530160000_add_subscriber_and_publisher_logo`. Reconcile dev
via `prisma db execute` + `prisma migrate resolve --applied` + `prisma generate`
(prisma migrate dev/reset are blocked for the agent).

> **Postgres note:** `ALTER TYPE ... ADD VALUE` cannot run in the same
> transaction as statements that *use* the new value, but it CAN coexist with
> unrelated DDL (the `ADD COLUMN`s here don't reference the enum). Repo
> precedent confirms this: `20260526210000_order_cancellation_and_editorial_veto`
> combines `ALTER TYPE ... ADD VALUE` (×3) with `ALTER TABLE ... ADD COLUMN` in
> one file and migrates cleanly. Use `ADD VALUE IF NOT EXISTS` (matching that
> migration's style) so the file is idempotent for the manual dev reconcile.

## 2. Marketing & app wiring

- `formats/page.tsx`: extend `Slug` union and `FORMATS` with
  `{slug:"native-plus", type:NATIVE_PLUS, key:"NATIVE_PLUS"}` and
  `{slug:"content-video", type:CONTENT_VIDEO, key:"CONTENT_VIDEO"}`.
- `(marketing)/page.tsx`: add both keys to `PRODUCT_TYPE_TO_FORMAT_KEY`
  (map to new `landing.catalog.fmt*` labels — `fmtNativePlus`,
  `fmtContentVideo`).
- `for-advertisers/page.tsx` + `catalog/page.tsx`: append both to `FORMAT_KEYS`.
- `price-request/[token]/page.tsx`: add two `<option>`s for desk drafting.

## 3. Creative-prep guide — `/resources/creative-specs`

New server-component page under `src/app/[locale]/(marketing)/resources/creative-specs/page.tsx`.
Documents, per format, the real preparation requirements:

- Article formats: 500–800 words; image ≥1200×628, ≤300 KB; title ≤70 chars,
  description ≤200 chars; 2–3 external links; lead times; disclosure label.
- Content Video: max duration (videoMaxSeconds guidance), hosting/format
  (videoHosting), thumbnail/teaser requirements.
- Native Plus: max shoppable products (shoppableMaxProducts), CTA wording
  (ctaGuidance), disclosure.

Copy is **documentation of what's true**, not a capability claim. New
`creativeSpecs` i18n namespace (landing structure or root — match whatever
`formats` uses). Linked from `/formats` (a "How to prepare" link) and the
shared footer.

## 4. i18n (all six locales: en, no, sv, da, fi, de)

- `productType`: `NATIVE_PLUS`, `descNATIVE_PLUS`, `CONTENT_VIDEO`,
  `descCONTENT_VIDEO`.
- `formats` page: `native-plus.{title,voice,brand,reads,bestFor,rule}` and
  `content-video.{...}`.
- `landing.catalog`: `fmtNativePlus`, `fmtContentVideo`.
- New `creativeSpecs` namespace (full copy).
- English authored first; translations natural/native (no calques), per the
  translation-quality rule. Verify key parity across all six locales.

Honest copy guardrails: Native Plus = "shoppable native article with in-article
product links / buy buttons"; Content Video = "video-led sponsored placement in
the publisher's player/feed." Do NOT imply self-serve programmatic video,
ad-server/DSP integration, dynamic product feeds, or live commerce.

## 5. Testing & verification

- `pnpm typecheck` — the `Record<ProductType,string>` homepage map makes a
  missed enum value a hard compile error (primary safety net).
- `pnpm build` — compiles all locales; surfaces missing i18n keys.
- i18n parity check (node script): all new keys present in all six locales for
  `productType`, `formats`, `landing.catalog`, `creativeSpecs`.
- `pnpm test` — full suite stays green; add a node:test for any pure helper
  introduced (e.g. a slug↔type map), but no heavy logic is expected.

## 6. Error handling

- New enum values flow through existing validated parsers (`parseType` in desk
  actions, catalog `.filter((s): s is ProductType => ...)`, price-request type
  parse) — unknown strings already rejected; the new values now pass.
- Spec columns nullable → existing products, specs, and the spec-check are
  unaffected; the spec-check ignores null fields.

## Out of scope

Targeting, A/B / conversion tracking, programmatic buying (later sub-projects),
and the rate-card publisher format strings (separate, unrelated to ProductType).
