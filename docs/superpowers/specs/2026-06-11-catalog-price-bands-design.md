# Catalog price bands + production fee — design

**Date:** 2026-06-11
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
| 5 | Production fee resolution | **Offer (Product) → publication (Title) → market default** (first set wins) |
| 6 | Exact figure exposure | Never shown in browse (grid / detail / compare / **public API**); only inside an actual quote tied to a brief |
| 7 | Card band selection | **Prefer the NATIVE_ARTICLE product's band** when one is shown; fall back to min across shown products. Prevents a cheap display product producing a "< 15k" band that feels like bait when the buyer wants the article |
| 8 | Firm-price turnaround | CTA copy commits to "firm price, typically within 2 business days" — a single tunable string. The bands only work if the firm number arrives fast; this makes turnaround part of the product promise. **Ops must confirm the 2-day target before launch** |

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
- **Bucket boundaries + production-fee defaults are placeholders outside
  Scandinavia.** Calibrated from ~50 real SE/DK/NO quotes; the EUR/GBP/CHF
  values are scale-guesses with no quote data behind them. **Trigger:**
  recalibrate each market's buckets and fee default after its first ~10
  applied quotes. Both live in one constants file so recalibration is a
  data-only PR.
- **`producedBy` (who writes the article).** Some publishers mandate their own
  content studio (e.g. Dagens Medicin); elsewhere we produce. v1 shows the
  generic "Includes written article" — true in both cases — and does NOT claim
  authorship. **Trigger:** if buyers ask "who writes it?", add a
  `producedBy: PLATFORM | PUBLISHER_STUDIO` enum on Product and surface it in
  the detail page's content spec, not the card.

## Pricing math

The customer-facing number is the marked-up indicative **plus a flat
production fee** (the fee is *not* marked up — it is added after the margin),
then snapped to a bucket:

```
indicative     = basePrice × (1 + marginPct/100) × seasonalMultiplier   // existing
customerPrice  = round(indicative) + productionFee
band           = priceBand(customerPrice, currency)
```

`indicative` is the existing computation (`indicativePrice` / `firmLineTotal`
in `src/lib/money.ts`, and `indicativeFromRules` used by the card). The only
additions are the `+ productionFee` term and the final `priceBand()` wrap.

## Components

### 1. Band engine — `src/lib/pricing/bands.ts` (new)

Single source of truth for turning a price into a bucket label.

```ts
export type BandKind = "under" | "range" | "over";
export type Band = { kind: BandKind; low: number | null; high: number | null };

// Per-currency bucket boundaries. Scandi kr and EUR/GBP/CHF differ ~10×.
// Boundaries are tunable; starting values calibrated from real 06-09/06-10
// quote data (native articles ~12–45k kr; packages to 150k; print to ~87k).
const BUCKETS: Record<string, number[]> = {
  NOK: [15_000, 25_000, 40_000, 60_000, 90_000],
  SEK: [15_000, 25_000, 40_000, 60_000, 90_000],
  DKK: [15_000, 25_000, 40_000, 60_000, 90_000],
  EUR: [1_500, 2_500, 4_000, 6_000, 9_000],
  GBP: [1_500, 2_500, 4_000, 6_000, 9_000],
  CHF: [1_500, 2_500, 4_000, 6_000, 9_000],
};

export function priceBand(amount: number, currency: string): Band { /* … */ }
```

- A price in `[boundary[i], boundary[i+1])` → `{ kind: "range", low, high }`.
- Below first boundary → `{ kind: "under", high: boundary[0] }`.
- At/above last boundary → `{ kind: "over", low: lastBoundary }`.
- **Why it's scrape-proof:** many distinct prices collapse to the same label,
  so neither the customer price nor the net `basePrice` is recoverable from the
  band. (A `±%` envelope would leak the midpoint; rounding to 5k would be near-
  exact — both rejected.)
- A formatting helper renders a `Band` + currency + locale into a localized
  string using the existing `intlLocale` / `Intl.NumberFormat` (e.g. "35–50k
  NOK", "90k+ NOK", "< 15k NOK"). Compact "k" notation, `maximumFractionDigits: 0`.

### 2. Production fee resolution — `src/lib/pricing/production-fee.ts` (new)

```ts
// Per-market default fee, in the market's currency. Tunable.
const MARKET_DEFAULT_FEE: Record<string, number> = {
  NO: 2000, SE: 2500, DK: 1500, FI: 200, DE: 200,
  AT: 200, CH: 200, UK: 180, IE: 200,
};

// First set value wins. 0 is a valid explicit value (publisher already
// includes production) and is NOT treated as "unset".
export function resolveProductionFee(args: {
  productFee: number | null;        // Product.productionFee  (this offer)
  titleFee: number | null;          // Title.productionFeeDefault (this pub)
  marketCode: string;
}): number { /* … */ }
```

Note: `0` must short-circuit the cascade — a publisher whose quote says "inkl.
produktion" gets `productionFee = 0`, and we still surface "Includes written
article" (the article is produced either way; the fee is just internal cost
recovery).

### 3. Data model — `prisma/schema.prisma`

```prisma
model Product {
  // …
  productionFee Decimal? @db.Decimal(12, 2)   // null = inherit; 0 = included
}

model Title {
  // …
  productionFeeDefault Decimal? @db.Decimal(12, 2)  // null = inherit
}
```

Migration: additive, both nullable, no backfill (null = inherit → market
default). Name: `add_production_fee`.

### 4. Price visibility integration

`visibility.ts` gate is unchanged. A new shared helper computes the display
band for a title so grid / detail / compare / API stay consistent:

```ts
// src/lib/pricing/visibility.ts (or a new display-price module)
export function titlePriceBand(title): { band: Band; currency: string } | null
```

It mirrors the card's current logic — filter `isProductPriceShown`, compute
`customerPrice` per shown product (indicative + resolved production fee) — but
selects the representative product per decision #7:

1. If a **NATIVE_ARTICLE** product is shown, band that one (it is the category
   lead and what the buyer almost always came for).
2. Otherwise band the **min** across shown products ("from" semantics).

Returns `null` when nothing is shown (→ "Contact for price" if `anyHidden`,
else nothing). The detail page is unaffected by #7 — it bands every product
individually, so the full picture is one click away.

### 5. UI surfaces

- **Catalog grid** (`CatalogResults.tsx`): replace the
  `{t("card.from")} {formatMoney(from, …)}` block with the band label +
  `· list (indicative) ⓘ` + a `✓ Includes written article` line. Estimate
  fallback (`anyHidden` → `requestPrice`) unchanged.
- **Detail page** (`catalog/[slug]/page.tsx`): per-product exact `formatMoney`
  → band. Keep the `FIRM` badge as a "firm rate" trust signal; the number is
  still banded. CTA wording → "Add to plan — firm price typically within 2
  business days" (decision #8; the turnaround figure is one i18n string).
- **Compare page** (`catalog/compare/page.tsx`): same exact → band swap in the
  price cells.

### 6. Public API — `api/v1/catalog/titles/route.ts` (**bug fix + band**)

Current code returns `basePriceIndicative: Number(p.basePrice)` — the **raw net
publisher cost**, leaking the cost basis. Replace with a band:

```ts
products: t.products.map((p) => {
  const shown = isProductPriceShown(p, t);
  return {
    id: p.id,
    type: p.type,
    priceBand: shown ? bandLabelFor(p, t) : null,   // was basePriceIndicative (raw cost)
    currency: p.currency,
    visibility: shown ? p.visibility : "INDICATIVE",
    leadTimeDays: p.leadTimeDays,
  };
});
```

Drop `basePriceIndicative` entirely. Partners get the same band as the UI,
never an exact figure, never the net cost.

### 7. Microcopy — `src/messages/en.json` (then translated to no/da/sv/fi/de)

Per the source-language-English-first standard, author in `en.json` first.

```jsonc
"priceVisibility": {
  "requestPrice": "Contact for price",          // unchanged (estimates)
  "listIndicative": "list (indicative)",
  "listIndicativeHelp": "Indicative list rate. Final price is confirmed after a short brief.",
  "productionIncluded": "Includes written article",
  "firmTurnaround": "Firm price typically within 2 business days",
  "band": {
    "range": "{low}–{high}",
    "over": "{value}+",
    "under": "< {value}"
  }
}
```

### 8. Whole-card clickable (quick win) — `CatalogResults.tsx`

Make `<article className="card catalog-card relative">` and give the title
`<Link>` an `after:absolute after:inset-0` overlay so the entire card navigates
to the detail page, while `TitleSelector` / Add-to-plan / compare controls sit
above (`relative z-10`) and keep working. Single semantic link — accessible.

## Parallel workstream (data ops, not code)

**Apply the ~50 pending quotes.** This is what actually makes real prices
appear (now as bands). Review each `PENDING` `PriceQuote` and `apply_quote`
(via the `native_apply_quote` MCP tool / desk flow). Where a quote says the
publisher already includes production, set that product's `productionFee = 0`.
Tracked separately from the code changes.

## Data flow

```
Product.basePrice ─┐
PriceRule (margin, ├─ indicativeFromRules ─→ indicative
 seasonal)        ─┘                            │
Product/Title/market ─ resolveProductionFee ─→ + productionFee
                                                │
                                          customerPrice
                                                │
                                          priceBand(·, currency)
                                                │
                        ┌───────────────────────┼───────────────────────┐
                     grid card              detail/compare           public API
                  band + "incl. article"   band per product        priceBand field
```

## Error / edge handling

- **No products / no shown products** → existing "Contact for price" /
  request-quote paths, unchanged.
- **Unknown currency** in `priceBand` → fall back to the EUR-scale buckets and
  log; never throw in a render path.
- **`productionFee = 0`** → valid; cascade stops; "Includes written article"
  still shown.
- **Price below first / above last bucket** → `under` / `over` band labels.
- **FIRM products** → banded in browse like everything else; firmness surfaces
  via badge and in the quote.

## Testing (node:test, per repo convention)

- `bands.test.ts`: bucket boundaries (inclusive/exclusive edges), under/over,
  per-currency scale, unknown-currency fallback, label formatting per locale.
- `production-fee.test.ts`: cascade order, `0` short-circuit, market default
  fallback, unknown market.
- `visibility` band helper: NATIVE_ARTICLE preference (decision #7) when one
  is shown, min-across-shown-products fallback, null when none shown, estimate
  titles never produce a band, cheap-display-plus-expensive-article case bands
  the article (regression guard against the "bait band").
- API contract: `priceBand` present when shown, `null` when hidden,
  `basePriceIndicative` absent (regression guard against the cost-leak).

## Files touched

| File | Change |
|------|--------|
| `src/lib/pricing/bands.ts` | **new** — bucket engine + label formatter |
| `src/lib/pricing/production-fee.ts` | **new** — fee cascade + market defaults |
| `src/lib/pricing/visibility.ts` | add `titlePriceBand` display helper |
| `prisma/schema.prisma` | `Product.productionFee`, `Title.productionFeeDefault` + migration |
| `src/app/[locale]/catalog/_components/CatalogResults.tsx` | band display, "incl. article", whole-card click |
| `src/app/[locale]/catalog/[slug]/page.tsx` | exact → band |
| `src/app/[locale]/catalog/compare/page.tsx` | exact → band |
| `src/app/api/v1/catalog/titles/route.ts` | `basePriceIndicative` (raw cost) → `priceBand`; cost-leak fix |
| `src/messages/en.json` (+ no/da/sv/fi/de) | new price-visibility strings |
| tests | `bands.test.ts`, `production-fee.test.ts`, visibility + API tests |
```
