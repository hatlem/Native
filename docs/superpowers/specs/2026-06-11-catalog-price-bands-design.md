# Catalog price bands + production fee — design

**Date:** 2026-06-11 (amended same day after codebase audit)
**Status:** Approved design, pending implementation plan
**Author:** Andreas + Claude

## Problem

Two complaints triggered this work:

1. **"Why does the catalog say *Contact for price* when we have the price?"**
2. **"Why can't I click the card to read more about the publisher?"**

Investigation surfaced the real causes and a strategy question underneath them.

### Root causes (factual)

- **Most catalog prices are estimates, not real prices.** The seed derives
  `basePrice = (monthlyReach / 1000) × perThousandReach` and leaves
  `Product.confirmedAt = null`. 200+ titles are in this state. The visibility
  gate (`src/lib/pricing/visibility.ts` — active + `confirmedAt` +
  `pricesPublic`) correctly hides them as "Contact for price." This is **not**
  a bug, and we must **not** bulk-set `confirmedAt`: that would publish guesses
  as firm prices and break the "100% confirmed, never guessed" data standard.
- **~50 real publisher quotes are sitting unapplied.** The 06-09/06-10 outreach
  pulled genuine inbound prices (ETC 30k SEK, idenyt 30–45k DKK, Amedia 50%-off
  deals, Egmont 30–40k SEK, Läkartidningen 55–73k SEK, …) into `PriceQuote`
  rows in `PENDING` state. Because nobody ran `apply_quote`, `confirmedAt` is
  still null, so those titles still say "Contact for price." **This** is the
  subset where "we have the price" is true — fixed by applying the quotes, not
  by changing the gate.
- **The card is barely clickable.** Only the title text links to
  `/catalog/[slug]` (`CatalogResults.tsx`); the other ~95% of the card is dead.

### Exact-price leak inventory (found during codebase audit)

The strategy below only works if **no** browse surface exposes an exact
figure. Audit found six surfaces; three currently leak worse than the UI:

| Surface | Today | Severity |
|---|---|---|
| Catalog grid (`CatalogResults.tsx`) | exact marked-up "from" price | by design, to be banded |
| Title detail (`catalog/[slug]/page.tsx`) | exact marked-up price per product | by design, to be banded |
| Compare (`catalog/compare/page.tsx`) | exact marked-up "from" price | by design, to be banded |
| JSON API (`api/v1/catalog/titles`) | **raw net `basePrice`** — our cost, un-marked-up | **cost-basis leak — bug** |
| CSV export (`api/export/catalog.csv`) | **raw net `basePrice`**, one-click download for any signed-in user | **cost-basis leak + literally a downloadable price sheet — bug** |
| JSON-LD (`catalog/[slug]` `<script type="application/ld+json">`) | exact marked-up price per product in machine-readable structured data | **easiest scrape target on the site** |

### Existing infrastructure this design must reuse (not duplicate)

The codebase already has a desk-owned content-production price list:

- **`ContentFeeRule`** (schema): per `(productType?, marketCode?)` with
  `greenfieldFee` / `adaptationFee`, most-specific active match wins
  (productType+market > productType > market > global). Desk-editable at
  `/desk/content-fees`. Seeded by `scripts/seed-content-fees.ts`
  (placeholders: NATIVE_ARTICLE 12 000 kr / 1 200 EUR-scale greenfield).
- **Pure math** in `src/lib/money.ts`: `pickContentFeeRule`,
  `computeContentFeeLines`, `ContentFeeRuleSpec`.
- **DB adapter** `src/lib/content-fee.ts`: `loadContentFeeRules()`.
- **Quote composition** already adds `CONTENT_FEE` lines when the buyer
  flags `withContent` / `authorshipMode` says NativeSpin produces.
- **`src/lib/authorship.ts`**: `AuthorshipMode` + `nativeSpinProduces()` —
  the "who writes the article" concept already exists.

So "production fee" market defaults come from **ContentFeeRule**, not a new
constants map; and the parked `producedBy` idea maps onto the existing
`AuthorshipMode`.

### Strategy question

For confirmed titles, what exactly do we reveal, and how do we frame it so a
buyer doesn't simply contact the publisher directly (disintermediation) or
scrape a clean price sheet (competitive harvesting)? Both threats matter
roughly equally.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Price model for confirmed titles | **Bucket bands** (fixed per-currency brackets), never an exact figure in browse |
| 2 | Estimate (unconfirmed) titles | Stay **"Contact for price"** — preserves the "confirmed, never guessed" standard |
| 3 | Deal/negotiability framing | **Neutral, no promise** — label "list (indicative)"; negotiability is communicated by the mechanic ("firm price after a brief"), not a discount claim |
| 4 | Production/writing cost | **Baked into the all-in band**, labeled **"Includes written article"** |
| 5 | Production fee resolution | **Offer (Product.productionFee) → publication (Title.productionFeeDefault) → desk price list (`ContentFeeRule.greenfieldFee`, most-specific match)** — first set value wins; `0` is a valid explicit value |
| 6 | Exact figure exposure | Never in browse: grid, detail, compare, JSON API, CSV export, JSON-LD. Exact figures exist only inside an actual quote tied to a brief |
| 7 | Card band selection | **Prefer the NATIVE_ARTICLE product's band** when one is shown; fall back to the cheapest shown product. Prevents a cheap display product producing a "< 15k" band that feels like bait when the buyer wants the article |
| 8 | Firm-price turnaround | CTA copy commits to "firm price typically within 2 business days" — a single tunable i18n string. The bands only work if the firm number arrives fast. **Ops must confirm the 2-day target before launch** |
| 9 | Band label format | Locale-neutral: `15–25k NOK`, `90k+ NOK`, `< 15k NOK`. "k" reads as thousand in every market; the ISO code avoids symbol ambiguity ("kr" is three currencies). No per-locale band i18n needed |

Out of scope (YAGNI): metering / price credits, anonymized titles, quantified
discount claims ("members pay X% less"). If scraping proves real later, the
existing API rate-limiter is the first lever, metering second.

### Parked for post-launch calibration (explicitly, with triggers)

- **"We often do better than list" soft claim.** Deliberately omitted in v1
  (decision #3 = neutral). Risk: a buyer comparing our all-in band against a
  publisher's placement-only rate card may read us as *more expensive*.
  **Trigger:** if funnel data shows drop-off at the price step, A/B the soft
  qualitative line first. Implementation: a single i18n string behind a flag —
  no structural change needed.
- **Bucket boundaries are placeholders outside Scandinavia.** Calibrated from
  ~50 real SE/DK/NO quotes; the EUR/GBP/CHF values are scale-guesses with no
  quote data behind them. **Trigger:** recalibrate each market's buckets after
  its first ~10 applied quotes. Buckets live in one constants block in
  `bands.ts` so recalibration is a data-only PR.
- **Production-fee amounts are desk data, not code.** The fee defaults come
  from `ContentFeeRule` rows, editable at `/desk/content-fees`. Current rows
  are seed placeholders (NATIVE_ARTICLE 12 000 kr greenfield); Andreas's
  intended ~2 000 NOK is **set there by ops**, per market/product type — no
  deploy needed.
- **`producedBy` (who writes the article).** Some publishers mandate their own
  content studio (e.g. Dagens Medicin); elsewhere we produce. v1 shows the
  generic "Includes written article" — true in both cases — and does NOT claim
  authorship. The concept already exists as `AuthorshipMode` in
  `src/lib/authorship.ts`. **Trigger:** if buyers ask "who writes it?",
  surface the existing authorship mode in the detail page's content spec, not
  the card.

## Pricing math

The customer-facing number is the marked-up indicative **plus a flat
production fee** (the fee is *not* marked up — it is added after the margin),
then snapped to a bucket:

```
indicative     = basePrice × (1 + marginPct/100) × seasonalMultiplier   // existing indicativeFromRules
fee            = Product.productionFee ?? Title.productionFeeDefault
                 ?? pickContentFeeRule(rules, productType, marketCode).greenfieldFee ?? 0
customerPrice  = round(indicative) + fee
band           = priceBand(customerPrice, currency)
```

`??` semantics: `null`/unset falls through; an explicit `0` short-circuits —
a publisher whose quote says "inkl. produktion" gets `productionFee = 0` and
we still show "Includes written article" (the article is produced either way).

## Components

### 1. Band engine — `src/lib/pricing/bands.ts` (new)

Single source of truth for turning a price into a bucket label. Used by all
six surfaces.

```ts
export type Band =
  | { kind: "under"; high: number }
  | { kind: "range"; low: number; high: number }
  | { kind: "over"; low: number };

// Per-currency bucket boundaries (ascending). Scandi kroner and the
// EUR-scale currencies differ ~10×. NOK/SEK/DKK calibrated from the
// 06-09/06-10 applied quotes; EUR/GBP/CHF are scale-guesses —
// recalibrate after each market's first ~10 applied quotes.
const BUCKETS: Record<string, number[]> = {
  NOK: [15_000, 25_000, 40_000, 60_000, 90_000],
  SEK: [15_000, 25_000, 40_000, 60_000, 90_000],
  DKK: [15_000, 25_000, 40_000, 60_000, 90_000],
  EUR: [1_500, 2_500, 4_000, 6_000, 9_000],   // also NL/BE/FI/DE/AT/IE
  GBP: [1_500, 2_500, 4_000, 6_000, 9_000],
  CHF: [1_500, 2_500, 4_000, 6_000, 9_000],
};

export function priceBand(amount: number, currency: string): Band;
export function bandLabel(band: Band, currency: string): string;
// "15–25k NOK" | "90k+ NOK" | "< 15k NOK"
```

- A price in `[boundary[i], boundary[i+1])` → range band; below the first →
  under; at/above the last → over.
- Unknown currency → EUR-scale fallback; never throw in a render path.
- **Why it's scrape-proof:** many distinct prices collapse to the same label,
  so neither the customer price nor the net `basePrice` is recoverable. (A
  `±%` envelope would leak the midpoint; 5k-rounding would be near-exact —
  both rejected.)

### 2. Production fee resolution — `src/lib/pricing/production-fee.ts` (new)

Thin cascade over the existing desk price list:

```ts
import { pickContentFeeRule, type ContentFeeRuleSpec } from "@/lib/money";

export function resolveProductionFee(args: {
  productFee: number | null;   // Product.productionFee   (this offer)
  titleFee: number | null;     // Title.productionFeeDefault (this publication)
  productType: string;
  marketCode: string;
  rules: ContentFeeRuleSpec[]; // loadContentFeeRules() — desk-editable
}): number;
```

First set value wins; `0` short-circuits; no matching rule → `0`.

### 3. Data model — `prisma/schema.prisma`

```prisma
model Product {
  // …
  productionFee Decimal? @db.Decimal(12, 2)   // null = inherit; 0 = publisher includes production
}

model Title {
  // …
  productionFeeDefault Decimal? @db.Decimal(12, 2)  // null = inherit from ContentFeeRule
}
```

Migration: additive, both nullable, no backfill. Hand-authored SQL (repo
convention — `migrate dev` is blocked; `migrate deploy` runs on deploy).

### 4. Display-price helper — `src/lib/pricing/display-price.ts` (new)

Pure functions shared by all six surfaces so they cannot drift:

```ts
customerPrice(product, title, rules): number          // indicative + fee
productBand(product, title, rules): Band | null       // null unless isProductPriceShown
titleBand(products, title, rules):                    // decision #7:
  { band: Band; product: P } | null                   //   NATIVE_ARTICLE if shown, else cheapest
```

`visibility.ts` gate is unchanged. The detail page bands every product
individually (full picture one click away); the card / compare / CSV use
`titleBand`.

### 5. Surfaces (all six)

- **Catalog grid** (`CatalogResults.tsx`): replace the exact
  `from {formatMoney(...)}` with `≈ {bandLabel} · list (indicative) ⓘ` plus a
  `✓ Includes written article` line. Estimate fallback ("Contact for price")
  unchanged.
- **Detail page** (`catalog/[slug]/page.tsx`): per-product exact → band. Keep
  the `FIRM` badge as a trust signal; the number is still banded. Add the
  decision-#8 note under Add-to-plan: "Firm price typically within 2 business
  days."
- **Compare page** (`catalog/compare/page.tsx`): exact → band in the
  "from price" row.
- **JSON API** (`api/v1/catalog/titles`): drop `basePriceIndicative` (raw cost
  leak); add `priceBand: string | null` (the band label). Partners get the
  same band as the UI.
- **CSV export** (`api/export/catalog.csv`): drop `indicative_price` (raw cost
  leak); add `price_band`. The one-click "download a price sheet" hole closes.
- **JSON-LD** (`catalog/[slug]`): per-product `Offer` loses its exact `price`;
  the title-level `AggregateOffer` carries the band bounds as
  `lowPrice`/`highPrice` (valid schema.org, keeps SEO value, no exact figure).

### 6. Microcopy — `src/messages/en.json` (then no/da/sv/fi/de)

Band labels are locale-neutral (decision #9) — no band i18n keys. New keys:

```jsonc
"priceVisibility": {
  "requestPrice": "Contact for price",          // unchanged (estimates)
  "listIndicative": "List price (indicative)",
  "listIndicativeHelp": "Indicative list rate — final price is confirmed after a short brief.",
  "productionIncluded": "Includes written article",
  "firmTurnaround": "Firm price typically within 2 business days"
}
```

### 7. Whole-card clickable (quick win) — `CatalogResults.tsx` + `globals.css`

Stretched-link pattern: `.catalog-card { position: relative }`, the title
`Link` gets `className="card-link"` with an `::after` overlay covering the
card; interactive children (compare checkbox, inner links) sit above via
`z-index`. Single semantic link — accessible.

## Parallel workstreams (ops, not code)

1. **Apply the ~50 pending quotes** (`native_apply_quote` / desk flow). This is
   what actually makes real prices appear (as bands). Where a quote says the
   publisher includes production, set that product's `productionFee = 0`.
2. **Set real production fees** in `/desk/content-fees` (current rows are
   12 000 kr seed placeholders; Andreas wants ~2 000 NOK for NO).
3. **Confirm the 2-business-day firm-quote turnaround** (decision #8) — it's
   in the buyer-facing copy.

## Data flow

```
Product.basePrice ─┐
PriceRule (margin, ├─ indicativeFromRules ─→ indicative
 seasonal)        ─┘                            │
Product.productionFee → Title.productionFeeDefault
  → ContentFeeRule (desk) ── resolveProductionFee ─→ + fee
                                                │
                                          customerPrice
                                                │
                                     priceBand(·, currency)
                                                │
        ┌──────────┬───────────┬────────────────┼───────────────┬──────────────┐
     grid card   detail     compare         JSON API         CSV export     JSON-LD
   (titleBand) (productBand)(titleBand)   (productBand)     (titleBand)  (band bounds)
```

## Error / edge handling

- **No products / no shown products** → existing "Contact for price" /
  request-quote paths, unchanged.
- **Unknown currency** in `priceBand` → EUR-scale fallback; never throw in a
  render path.
- **`productionFee = 0`** → valid; cascade stops; "Includes written article"
  still shown.
- **No matching ContentFeeRule** → fee `0` (band still renders).
- **Price below first / above last bucket** → `under` / `over` labels.
- **FIRM products** → banded in browse like everything else; firmness
  surfaces via badge and in the quote.

## Testing (node:test via `pnpm test`, repo convention)

- `bands.test.ts`: bucket edges (inclusive low / exclusive high), under/over,
  per-currency scale, unknown-currency fallback, label formatting incl.
  fractional k ("1.5–2.5k EUR").
- `production-fee.test.ts`: cascade order, `0` short-circuit at each level,
  ContentFeeRule most-specific match passthrough, no-rule → 0.
- `display-price.test.ts`: fee inclusion in customerPrice, NATIVE_ARTICLE
  preference (decision #7), cheapest fallback, null when nothing shown,
  estimate titles never produce a band, cheap-display-plus-expensive-article
  bands the article (regression guard against the "bait band").
- API/CSV: assert `priceBand` present when shown / null when hidden, and that
  `basePriceIndicative` / `indicative_price` are gone (regression guard
  against the cost leak).

## Files touched

| File | Change |
|------|--------|
| `src/lib/pricing/bands.ts` | **new** — bucket engine + locale-neutral label |
| `src/lib/pricing/production-fee.ts` | **new** — fee cascade over ContentFeeRule |
| `src/lib/pricing/display-price.ts` | **new** — customerPrice / productBand / titleBand |
| `prisma/schema.prisma` + migration | `Product.productionFee`, `Title.productionFeeDefault` |
| `src/app/[locale]/catalog/_components/CatalogResults.tsx` | band display, "incl. article", whole-card click |
| `src/app/[locale]/catalog/[slug]/page.tsx` | exact → band; JSON-LD band bounds; turnaround note |
| `src/app/[locale]/catalog/compare/page.tsx` | exact → band |
| `src/app/api/v1/catalog/titles/route.ts` | raw-cost leak → `priceBand` |
| `src/app/api/export/catalog.csv/route.ts` | raw-cost leak → `price_band` |
| `src/app/globals.css` | stretched-link card CSS |
| `src/messages/{en,no,da,sv,fi,de}.json` | new priceVisibility strings |
| tests | `bands.test.ts`, `production-fee.test.ts`, `display-price.test.ts` |
