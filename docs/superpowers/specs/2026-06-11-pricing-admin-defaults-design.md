# Admin-configurable commission + fee overrides — design

**Date:** 2026-06-11
**Status:** Approved (user confirmed scope incl. configurable default commission)
**Builds on:** 2026-06-11-catalog-price-bands-design.md (production-fee cascade, band engine)

## Problem

The pricing model already composes `customerPrice = basePrice × (1 + margin%) + productionFee`, but admin control is incomplete:

| Lever | Model | Admin UI today |
|---|---|---|
| Default flat fee (market × productType, global fallback) | `ContentFeeRule` | ✓ `/desk/content-fees` |
| Per-title fee override (`Title.productionFeeDefault`) | ✓ (shipped 06-11) | ✗ none |
| Per-product fee override (`Product.productionFee`) | ✓ (shipped 06-11) | ✗ none |
| Per-product margin % (`PriceRule.marginPct`) | ✓ | ✗ none (seed/DB only) |
| Default margin % | ✗ hardcoded `DEFAULT_MARGIN_PCT = 15` (money.ts:71) | ✗ |

Requirement (user): default price levers set in admin, overridable per publication and per
offer; commission-% and flat fee usable together or alone.

## Decisions

1. **New model `MarginRule`** mirroring `ContentFeeRule`'s most-specific-wins pattern,
   market dimension only (no productType — YAGNI, addable later):

   ```prisma
   model MarginRule {
     id         String      @id @default(cuid())
     marketCode MarketCode? // null = global fallback; most-specific active wins
     marginPct  Decimal     @db.Decimal(5, 2)
     active     Boolean     @default(true)
     note       String?
     createdAt  DateTime    @default(now())
     updatedAt  DateTime    @updatedAt

     @@index([active, marketCode])
   }
   ```

   No backfill: with zero rows the code falls back to the constant 15 → no behavior
   change until the desk sets something.

2. **Commission resolution order:** `PriceRule` (per product) → `MarginRule` for market →
   `MarginRule` global → `DEFAULT_MARGIN_PCT` (15, last-resort constant).
   No per-title margin override (YAGNI — per-product covers it).

3. **One defaults bundle for all consumers.** New `PricingDefaults` value
   `{ feeRules: ContentFeeRuleSpec[]; marginRules: MarginRuleSpec[] }` loaded by a single
   `loadPricingDefaults()` (DB adapter, replaces surfaces' direct `loadContentFeeRules()`
   call). `display-price.ts` signatures change from `rules: ContentFeeRuleSpec[]` to
   `defaults: PricingDefaults`; margin default resolved internally per title market.
   Catalog bands and desk quotes therefore always agree.

4. **Quote/intelligence threading:** `money.ts` rule-fallback sites (line ~117 quote-line
   computation, line ~239 `indicativeFromRules`) gain an optional trailing
   `defaultMarginPct = DEFAULT_MARGIN_PCT` parameter; untouched callers keep today's
   behavior. Desk quote composition and `pricing-intelligence.ts` pass the resolved
   market default.

5. **Admin UI:**
   - `/desk/content-fees` gains a **"Default commission"** section (create global/per-market
     rule, bulk-edit grid, toggle) following the page's existing ContentFeeRule patterns
     and the same `requireDesk` action guard.
   - `/desk/titles/[id]` gains: title-level **production-fee default** field, and per
     product row: **margin %** (upserts the product's `default`-labeled PriceRule) and
     **production fee** override.
   - Input semantics everywhere: **blank = inherit** from the level above; explicit
     **0 = publisher includes production** (fee) — band still shows "Includes written
     article". Margin blank = inherit; 0 is a valid explicit margin.

6. **i18n:** English first in `en.json` (`contentFees.margin*`, `titleAdmin.*` additions),
   translated to no/da/sv/fi/de.

## Out of scope

- Margin per productType (same pattern, later if needed)
- Per-title margin override
- Seasonal multiplier admin UI

## Quality gates (hard, learned 06-11)

- `pnpm typecheck` must be **0 errors** after every task — typecheck errors block prod
  deploys (`next build` typechecks `scripts/` too).
- Final gate before any push: **local `pnpm build` green**.

## Files touched

| File | Change |
|---|---|
| `prisma/schema.prisma` + migration | `MarginRule` model |
| `src/lib/money.ts` | `MarginRuleSpec`, `pickMarginRule`, optional `defaultMarginPct` params |
| `src/lib/content-fee.ts` (or new `pricing-defaults.ts`) | `loadPricingDefaults()` |
| `src/lib/pricing/display-price.ts` | `PricingDefaults` signature + internal margin resolution |
| 6 band surfaces (grid/detail/compare/API×2/CSV) | `loadContentFeeRules()` → `loadPricingDefaults()` |
| `src/lib/pricing-intelligence.ts` | resolved default instead of constant |
| desk quote composition call sites | pass resolved market default |
| `/desk/content-fees` page + actions | margin section |
| `/desk/titles/[id]` page + actions | fee + per-product margin/fee fields |
| `src/messages/{en,no,da,sv,fi,de}.json` | new strings |
| tests | margin picker, defaults resolution, display-price with PricingDefaults |
