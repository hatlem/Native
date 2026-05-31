# Targeting — Design Spec

**Date:** 2026-05-31
**Status:** Approved (design); pending spec review
**Sub-project:** 3 of 5 in the SUNT-gap competitive build

## Context

Competitor SUNT markets "targeting" (geo, sociodemographic, interest,
retargeting, contextual). NativeSpin sells native-content placements on
specific named publisher titles across 9 markets — it has **no user-level
data**. So targeting here can only honestly mean **selecting and briefing by
real title attributes**, never user-level sociodemographic / behavioral /
retargeting.

Decisions locked during brainstorming:

- **Scope:** structured targeting brief + honest framing **and** enrich geo
  data into a real filterable dimension.
- **Claim boundary:** market ONLY contextual (category/vertical/topic),
  geographic (market/country/region/reach-tier), and title-level audience
  segment. Explicitly NOT sociodemographic, interest/behavioral, or
  retargeting.
- **Targeting intent lives campaign-level on `Plan`.**
- **Geo:** add structured `region` + `city` columns; backfill confident-only
  from `locationNote`, leave the rest null.

**Verified i18n claim audit** (the repo's `grep` is aliased to `ugrep` and
mangles output — audited via a Node line-scan instead):

- **One genuine false claim to fix:** `formats.native-display.bestFor` =
  "Reach, **retargeting**, awareness against a curated audience" — this lists
  retargeting as a strength of NativeSpin's OWN native-display format. Under the
  claim boundary that's false (no user-level data). Fix in all six locales:
  drop "retargeting", e.g. EN → "Reach and awareness against a curated
  audience." (no/sv/da/de/fi equivalently).
- **Leave alone (honest competitor contrast):** the `bestFitDisplay` strings in
  the native-vs-display comparison (root `landing.vs` / `vs` namespace and
  `src/messages/landing/<loc>/vs.json`) describe **display / programmatic —
  the competitor** NativeSpin contrasts itself against ("Performance
  retargeting, simple offers", "ecommerce retargeting, broad reach at low
  CPM"). These are accurate positioning, not NativeSpin claims.
- **Also fine, no change:** `quoteNarrative.bullets.NATIVE_DISPLAY` =
  "Targeted by section and audience segment" — contextual + title-audience
  segment is exactly within the allowed boundary.

## Grounding (current state, verified)

- `Title` already carries targeting-relevant attributes: `countryCode`,
  `category`, `vertical`, `audience`, `b2bB2c`, `reach` (National/Regional/
  Local/Niche), `nativeFit`, `format`, `frequency`, `ownerGroup`, `tags`,
  `locationNote` (free-text city/note), `monthlyReach`/`digitalReach`
  (`prisma/schema.prisma` Title model, ~line 244-331; most indexed).
- Catalog already filters by: market, product type/format, vertical,
  nativeFit, b2bB2c, onlyPriced, full-text search
  (`src/app/[locale]/catalog/page.tsx` ~44-160;
  `_components/CatalogFilters.tsx`). Vertical options are dynamically
  populated from distinct `Title.vertical` values — the pattern the region
  filter will copy.
- `Plan` has free-text `audienceNote` + `goal` only; no structured targeting
  (`prisma/schema.prisma` Plan model). Plan/RFQ form captures free-text
  `audience`/`goal`/`brief` (`src/app/[locale]/plan/page.tsx`).
- `locationNote` real examples: "Trondheim", "Jæren", "Asker/Bærum",
  "Bergen", "Dresden consumer", "Vienna affluent" (from
  `prisma/data/medier_alle.csv`).
- `Title.audience` real examples: "General consumer", "Regional consumer",
  "B2B – Energy", "Business decision-makers", "Affluent women 35+",
  "Tech decision-makers". These are publisher editorial-audience labels, not
  user traits.

## 1. Geo enrichment (schema + backfill)

Add to `Title` (both nullable, both indexed):

```prisma
  // Controlled sub-national area derived from locationNote where confident
  // (e.g. "Vestlandet", "Bavaria"). Null when national or unknown.
  region String?
  // City derived from locationNote where confident (e.g. "Trondheim").
  // Null when national/regional or unparseable. locationNote stays the raw note.
  city   String?
```

`@@index([region])`, `@@index([city])`.

One additive migration: `ALTER TABLE "Title" ADD COLUMN "region" TEXT`,
`ADD COLUMN "city" TEXT`, two `CREATE INDEX`. Hand-authored under
`prisma/migrations/<ts>_add_title_region_city/`, sorting after the formats
migration `20260531120000_add_native_plus_content_video`; applied via
`prisma db execute` + `prisma migrate resolve --applied` + `prisma generate`
(migrate dev is blocked for the agent).

**Backfill:** `scripts/backfill-title-geo.ts` (run-once via `tsx`, idempotent —
only writes where `region`/`city` are currently null). Uses a pure
`parseGeo(locationNote, marketCode)` function backed by a per-market
city→region lookup table covering the confident cases present in the CSV. Rules:
- Exact known-city match → set `city` + its `region`.
- Multi-city note ("Asker/Bærum") → set `region` (shared area) if both map to
  one region; else city = first known token, region from it.
- Notes like "Dresden consumer" → strip the trailing descriptor, match the city.
- No confident match, or empty → leave both null.
The script prints a summary: N titles updated, M left null, per market.

> No fuzzy/LLM matching — deterministic table only. A title with null geo
> simply doesn't appear in the region filter. Honest over complete.

## 2. Catalog region filter (live)

- Add a **region** multi-select to the catalog, dynamically populated from
  distinct non-null `Title.region` values for the current result set — mirror
  exactly how `vertical` options are derived and how its `where` clause is
  built (`vertical: { in: [...] }` → `region: { in: [...] }`).
- Param `region` (CSV in searchParams), parsed alongside the existing filters.
- `city` is NOT a top-level filter (too sparse); it shows as title metadata and
  remains searchable via the existing FTS/ILIKE path (add `city` to the search
  columns).
- `CatalogFilters.tsx` gets a region group following the vertical group's
  markup/handlers.

## 3. Structured targeting brief on `Plan` (campaign-level)

Add to `Plan` (all nullable; free-text `audienceNote`/`goal` stay):

```prisma
  // Structured campaign targeting intent — what the buyer wants to reach.
  // Descriptive, used by the desk to pick titles; NOT an ad-server audience.
  targetGeo       String? // comma-separated markets/regions chosen, e.g. "NO,SE; Vestlandet"
  targetAudience  String? // comma-separated segment labels from the title audience taxonomy
  targetContext   String? // comma-separated categories/verticals
```

(Same additive migration as §1 — one file, all `Title` + `Plan` columns
together. `Plan` columns don't reference the geo columns, so combining is safe.)

- Plan/RFQ form (`src/app/[locale]/plan/page.tsx`) gains three structured
  selectors writing these fields:
  - **Geo:** market checkboxes + region multi-select (regions sourced from the
    distinct `Title.region` set).
  - **Audience segment:** a curated controlled list distilled from the real
    `Title.audience` values (e.g. "B2B decision-makers", "Regional consumers",
    "Affluent 35+", "Lifestyle / hobby", "Healthcare professionals"). Defined
    once in `src/lib/targeting/segments.ts` as a typed constant + label keys.
  - **Context:** category/vertical multi-select.
- `submitRequest` persists them on the Plan and includes a readable summary in
  the desk-facing `Request.briefSummary` render so the desk sees structured
  intent.

## 4. Marketing — honest targeting framing

- New targeting section on `/for-advertisers` naming the three honest
  dimensions — **contextual**, **geographic**, **audience segment** — each with
  one line, plus an explicit "what we don't do" line (no behavioral /
  retargeting / user-level data). Turns existing capability into a named
  selling point and pre-empts the false-claim risk.
- New `targeting` i18n namespace (or a block in the `advertisers` namespace)
  for this copy. No new standalone page (keep it on the page buyers already
  read).
- **Fix the one false claim** in `formats.native-display.bestFor` (drop
  "retargeting") across all six locales, as detailed in the claim audit above.

## 5. i18n (all six locales: en, no, sv, da, fi, de)

- Catalog: region filter label + (if needed) group heading.
- Plan form: targeting selector labels (geo / audience / context) + the
  segment option labels.
- `/for-advertisers` targeting section copy.
- `formats.native-display.bestFor`: remove "retargeting" (all six locales).
- English first; natural native translations (no calques); parity-checked.

## 6. Testing & verification

- node:test for pure `parseGeo(locationNote, marketCode)`: confident city match,
  multi-city ("Asker/Bærum"), trailing-descriptor ("Dresden consumer"),
  ambiguous/unknown → null, empty → null.
- node:test for the `segments.ts` taxonomy helper if it has logic (e.g.
  mapping a `Title.audience` value to a segment) — otherwise it's a typed
  constant verified by `tsc`.
- `pnpm typecheck` + `pnpm build` + i18n parity script.
- Run `scripts/backfill-title-geo.ts` against the real dev DB and report the
  updated/null split per market (sanity that the lookup table covers a
  meaningful share without over-reaching).

## Slices (separately committable)

1. Schema + migration (Title.region/city + Plan.target*) + `parseGeo` + tests.
2. Backfill script + run + summary.
3. Catalog region filter (+ city in search).
4. Plan targeting brief (selectors + persistence + desk summary) + segments.ts.
5. Marketing targeting section + i18n (all six locales).

## Out of scope

A/B / conversion tracking, programmatic buying (later sub-projects). The
recommender stays reach-optimized (audience-weighted recommendation is a
possible follow-up, not this sub-project). No user-level targeting of any kind.
