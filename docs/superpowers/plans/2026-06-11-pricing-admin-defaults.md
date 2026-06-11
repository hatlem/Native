# Pricing Admin Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Admin-configurable default commission (MarginRule) + admin UI for the fee/margin override cascade.

**Architecture:** New `MarginRule` model mirrors `ContentFeeRule` (most-specific-wins, null market = global). A `PricingDefaults` bundle (`feeRules` + `marginRules`) loaded by one adapter feeds display-price (signature change) so bands and quotes share one margin source. Admin UI extends the existing `/desk/content-fees` CRUD patterns and `/desk/titles/[id]`.

**Spec:** `docs/superpowers/specs/2026-06-11-pricing-admin-defaults-design.md` — read first.
**Branch:** `feat/pricing-admin-defaults`. Repo conventions as per previous plan (node:test next to source, hand-authored migrations — `migrate dev` blocked, conventional commits, en.json first).

**HARD GATES (every task):** `pnpm typecheck` = **0 errors** (not "no new errors" — zero), `pnpm test` 0 fail. Final task: local `pnpm build` green. These block prod deploys.

---

### Task 1: MarginRule schema + migration

- Add `MarginRule` model to `prisma/schema.prisma` exactly as specced (place near `ContentFeeRule`, copy its comment style: desk-owned default commission, most-specific active match wins, null market = global).
- Hand-author `prisma/migrations/20260611230000_margin_rule/migration.sql`:

```sql
-- Desk-owned default commission (%). Null marketCode = global fallback;
-- most-specific active row wins. No rows -> code falls back to 15.
CREATE TABLE "MarginRule" (
    "id" TEXT NOT NULL,
    "marketCode" "MarketCode",
    "marginPct" DECIMAL(5,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarginRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarginRule_active_marketCode_idx" ON "MarginRule"("active", "marketCode");
```

- `pnpm prisma generate && pnpm typecheck` (0 errors); `pnpm prisma migrate deploy` against local DB if reachable (don't block).
- Commit: `feat(db): MarginRule default-commission model`

### Task 2: money.ts margin picker + default threading (TDD)

- Add to `src/lib/money.ts` (near ContentFeeRuleSpec):

```ts
export type MarginRuleSpec = {
  marketCode: string | null;
  marginPct: number;
  active: boolean;
};

// Most-specific active match: market beats global. No match -> null
// (callers fall back to DEFAULT_MARGIN_PCT).
export function pickMarginRule(
  rules: MarginRuleSpec[],
  marketCode: string,
): MarginRuleSpec | null;

export function resolveDefaultMarginPct(
  rules: MarginRuleSpec[],
  marketCode: string,
): number; // pickMarginRule ?? DEFAULT_MARGIN_PCT
```

- Thread optional `defaultMarginPct: number = DEFAULT_MARGIN_PCT` as trailing param into the two `DEFAULT_MARGIN_PCT` fallback sites: the quote-line computation (~line 117) and `indicativeFromRules` (~line 239). READ the surrounding functions first; do not change any existing call sites' behavior (optional param).
- Tests in `src/lib/money.test.ts` (append, follow file style): market beats global; inactive ignored; no match → 15 via resolveDefaultMarginPct; explicit defaultMarginPct param respected by indicativeFromRules when rules empty.
- Gates. Commit: `feat(pricing): admin default margin resolution`

### Task 3: PricingDefaults loader + display-price signature (TDD)

- In `src/lib/content-fee.ts` add:

```ts
export type PricingDefaults = {
  feeRules: ContentFeeRuleSpec[];
  marginRules: MarginRuleSpec[];
};
export async function loadPricingDefaults(): Promise<PricingDefaults>; // two findMany({where:{active:true}}) queries
```

- `src/lib/pricing/display-price.ts`: change the third param of `customerPrice`, `productBand`, `titleBand` from `rules: ContentFeeRuleSpec[]` to `defaults: PricingDefaults`; internally `indicativeFromRules(Number(p.basePrice), toRateRules(p.priceRules), 1, resolveDefaultMarginPct(defaults.marginRules, title.market.code))` and fee resolution uses `defaults.feeRules`. Update module docblock.
- Update `display-price.test.ts`: wrap existing RULES in `{ feeRules: RULES, marginRules: [] }`; add cases: marginRules global 20% → 30000×1.20+2000=38000; market rule beats global; empty marginRules keeps 15% behavior (36500 case unchanged).
- This task does NOT touch the surfaces — they break typecheck until Task 4, so Tasks 3+4 are ONE commit by the same implementer. (Run gates only after Task 4 edits.)

### Task 4: Swap surfaces to loadPricingDefaults (same implementer/commit as Task 3)

Mechanical: in the 6 surfaces (`catalog/_components/CatalogResults.tsx`, `catalog/[slug]/page.tsx`, `catalog/compare/page.tsx`, `api/v1/catalog/titles/route.ts`, `api/v1/catalog/titles/[id]/route.ts`, `api/export/catalog.csv/route.ts`): replace `loadContentFeeRules()` with `loadPricingDefaults()` (variable `pricing` or `defaults`) and pass it to titleBand/productBand. Also `src/lib/pricing-intelligence.ts`: replace the `DEFAULT_MARGIN_PCT` use at ~line 95 with a resolved market default where market code is in scope (READ the function; if market unavailable cheaply, keep constant and note why in a comment).
- Gates (now green). Commit: `feat(pricing): bands+quotes share admin margin defaults`

### Task 5: /desk/content-fees — Default commission section

- READ `src/app/[locale]/desk/content-fees/page.tsx` + `actions.ts` fully; mirror patterns exactly (requireDesk guard, parse helpers, revalidatePath, recordAudit).
- Actions: `createMarginRule` (marketCode optional → null, marginPct required 0–95, note), `bulkUpdateMarginRules` (`m_<id>` inputs), `toggleMarginRule`.
- Page: new section "Default commission" mirroring the fee sections: create form (market select with "Any market" option, marginPct number step 0.5, note) + bulk grid (market, marginPct input, status, toggle) listing `prisma.marginRule.findMany`.
- i18n keys under `contentFees.margin*` — ENGLISH ONLY in this task (en.json); other locales in Task 7.
- Gates (typecheck tolerates only missing-translation behavior next-intl handles at runtime — keys must exist in en.json). Commit: `feat(desk): default commission admin`

### Task 6: /desk/titles/[id] — fee + per-product margin overrides

- READ the page + its actions file first (find the actions used by that page — grep `"use server"` imports there).
- Title section: number field `productionFeeDefault` (blank = inherit → null; 0 valid) + save action updating Title, audit `title.production_fee_default`.
- Per-product rows (the page lists products): two inputs per row — `marginPct` (blank = inherit; upserts the product's PriceRule with `label: "default"`: update first rule if exists else create with minVolume 1, seasonal 1) and `productionFee` (blank → null = inherit, 0 valid), one save action per product or bulk form following whatever pattern the page already uses for product edits.
- Helper text under fields: inherit semantics (i18n keys `titleAdmin.*`, English only this task).
- Gates. Commit: `feat(desk): per-title/product pricing overrides`

### Task 7: i18n — translate new keys to no/da/sv/fi/de

- All keys added in Tasks 5–6 (`contentFees.margin*`, new `titleAdmin.*`) translated natural-style (no calques) into the 5 locale files; verify with the locale-check one-liner (adapt key list).
- Gates. Commit: `feat(i18n): pricing admin strings, 6 locales`

### Task 8: Verification sweep

- `pnpm test` (0 fail), `pnpm typecheck` (0 errors), `pnpm lint` clean, **`pnpm build` green locally** (the deploy gate).
- Consistency grep: no remaining `loadContentFeeRules(` call sites outside content-fee.ts itself + tests; no `DEFAULT_MARGIN_PCT` in surface/UI code (only money.ts + resolveDefaultMarginPct fallback + pricing-intelligence if justified).
- Report branch summary for merge decision.
