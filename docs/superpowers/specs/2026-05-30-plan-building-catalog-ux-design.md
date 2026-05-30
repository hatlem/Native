# Plan-building & Catalog UX — Design

**Date:** 2026-05-30
**Status:** Implemented (pending staging verification)
**Goal:** Make it easy and best-in-class for a buyer to go from "empty plan" to a real brief/RFQ — by guiding discovery (brief → recommended titles), fixing the catalog's missing filters, and cleaning up two plan-page defects (static quantity, oversized request-price totals).

## Problem

The `/[locale]/plan` empty state just says "Your plan is empty." with a small "Browse the catalog" / "Recommend" CTA, so first-time buyers who don't know which of 3,153 titles to pick bounce. Three concrete UX defects compound it:
- The catalog can't be filtered by **category/vertical** (the field shown most prominently on every card), even though that's how buyers think ("I want business / sports / lifestyle readers").
- Plan lines show a static **"Qty: 1"** with no control — quantity is actually mutable (`addToPlan` increments on re-add) but there's no stepper, so it reads as broken.
- The plan **summary sidebar** renders request-price totals at the giant `.price` figure size — `SEK · Contact for price` / `CHF · …` / `EUR · …` stacked huge for a multi-market basket.

A budget-driven recommendation engine already exists (`src/lib/recommend.ts` → `recommendMix`, surfaced at `/recommend`) but is buried as a secondary link; the brief fields (budget/audience/goal/free-text) already exist on the plan form and persist in the `nativespin_brief` cookie. Much of the raw material is present but not wired into a guided experience.

## Decisions (locked during brainstorming)

1. **Recommendation match signal:** budget + market only — reuse the existing `recommendMix`. Goal/audience/free-text brief still ride along to the desk but do NOT drive matching.
2. **Flow shape:** inline on the empty plan state (no page hop), query-param driven (server-rendered, no client JS), mirroring the catalog's filter pattern.
3. **Candidate pool:** tiered — budget-optimized picks from priced (firm + indicative) titles, then supplementary top-reach titles (incl. Contact-for-price, shown as "Request price") so the panel is useful despite sparse firm inventory (only ~1 of 3,153 titles is confirmed-firm-priced in prod today).
4. **Scope:** all four parts in one spec (cohesive "make plan-building easy").
5. **Quantity:** editable stepper (− / n / +); native placements can be multi-quantity (quantity already flows into the Quote line + `firmLineTotal`).
6. **Category filter field:** filter on `Title.vertical` (human-readable, the prominent card label), UI-labelled "Category"; options come from **distinct DB values** (free-text CSV, not an enum).

## Existing code this builds on

- `src/app/[locale]/plan/page.tsx` — empty state (~157), plan lines (~183, static `Qty` at 189), summary sidebar (~219-248, request-price `.price` lines at 235-239), brief form (~261+).
- `src/lib/basket.ts` — `BasketItem = { productId, quantity }`, `nativespin_plan` + `nativespin_brief` cookies, `parseBasket`/`readBasket`/`writeBasket`.
- `src/app/actions.ts` — `addToPlan` (increments quantity, ~73-84), `removeFromPlan` (~110-116), `submitRequest` (~127-366, reads brief, creates Plan/Request).
- `src/lib/recommend.ts` — `recommendMix(candidates, budget, {category?})` greedy reach-per-€; `Candidate` type.
- `src/app/[locale]/(marketing)/recommend/page.tsx` — builds candidates (firm-only today: `confirmedAt: { not: null }` + `arePricesVisible`).
- `src/lib/pricing/visibility.ts` — `arePricesVisible`, `isProductPriceShown`. `src/lib/money.ts` — `indicativeFromRules`, `toRateRules`, `firmLineTotal`.
- `src/app/[locale]/catalog/page.tsx` — `where` builder (~116-143), filter option props (~275-278, enum-based), card renders `title.vertical` (374) + `title.category` tag (350).
- `src/app/[locale]/catalog/_components/CatalogFilters.tsx` — filter UI (markets/formats/nativeFits/b2bB2cs; b2bB2c under "Advanced").
- i18n: `src/messages/*.json` namespaces `plan`, `rfq`, `firm`, and catalog filter keys.

---

## 1. Empty-state: brief → recommend panel

**UX.** When the basket is empty, replace the `EmptyState` with a **"Start your campaign"** panel:
- **Market** select — defaults to the org's onboarding `marketCode` if set, else first of the 9; switchable.
- **Budget** number input.
- Optional one-line **goal** text — persists into the `nativespin_brief` cookie (so it pre-fills the brief later); NOT used for matching.
- **"Recommend titles"** submit (GET) → reloads `/plan` with `?recMarket=DE&recBudget=50000` (+ optional `recGoal`).

When `recMarket` is present and the basket is still empty, render a **Recommended mix** section below the panel:
- **Tier 1 (budget-optimized):** the `recommendMix` picks (reach-per-€ packed to budget) from priced candidates. Header: "Recommended for your budget". Each row: title · publisher · reach · indicative line price, **Add to plan**.
- **Tier 2 (supplementary):** if Tier 1 under-fills the budget (or returns few), append top-reach active titles in the market with no visible price, labelled "Request price". Header: "Also worth considering". One product per title.
- **Add all priced picks** button (adds Tier 1 productIds).
- Adding routes through the existing `addToPlan(productId)`; once anything is in the basket the normal plan view + brief sidebar render. A quiet "Browse the full catalog" secondary link remains.

**Recommendation logic** (extend `src/lib/recommend.ts`, keep pure/testable):
- New `buildTieredRecommendation(candidates, budget)` (or extend the page-level candidate build) that:
  - **Tier 1 candidates** = active products, `arePricesVisible(title)`, with a derivable indicative/firm unit price (`indicativeFromRules`); run `recommendMix(tier1, budget)`.
  - **Tier 2 candidates** = active titles in the market NOT already picked and without a visible price; rank by reach (`digitalReach ?? monthlyReach ?? 0`) desc; cap (e.g. top 6); one product/title.
  - Returns `{ picks: Candidate[], supplementary: TitleLite[], totalCost, totalReach }`.
- The candidate query lives in `plan/page.tsx` (server), scoped to `recMarket`: pull active products + title + publisher + priceRules for the market, map to `Candidate` (reach = `digitalReach ?? monthlyReach ?? 0`, unitPrice = `indicativeFromRules`), and the unpriced title set for Tier 2.

**Edge cases:** no titles at all in market → fall back to the browse-catalog CTA. Budget empty/invalid → skip Tier 1 budget math, show Tier 2 (reach-ranked) only. Market with priced inventory but budget too small for any pick → show Tier 1 empty + Tier 2.

---

## 2. Catalog: the missing filters

**Category filter.** Add a **Category** filter (multi-select, same popover pattern as Market/Format) over `Title.vertical`:
- Options = **distinct non-null `vertical` values** from the catalog, computed server-side (`prisma.title.findMany({ where: { active: true }, distinct: ["vertical"], select: { vertical: true }, orderBy: { vertical: "asc" } })`, filter out null/empty). This is dynamic (free-text CSV), unlike the enum-based Market/Format/Native-fit options.
- Wire into the `where`: `...(verticals.length ? { vertical: { in: verticals } } : {})`. Read `sp.vertical` as a comma-joined param, mirroring `types`/`markets`.
- Add the active-filter chip + `filterHref` handling like the other filters.

**Promote B2B/B2C** out of "Advanced" into the main filter row. New filter order: **Market → Category → Audience (B2B/B2C) → Format → Native fit → Priced-only**. (Native-fit may move under Advanced if the row gets crowded — keep Market/Category/Audience primary.)

**i18n:** add `filters.category` (label "Category") + `categoryCount` to all 6 locales. `vertical` values themselves are data, shown verbatim (no translation).

---

## 3. Plan lines: quantity stepper

Replace the static `Qty: {n}` (`plan/page.tsx:189`) with a **− / n / +** stepper:
- New server action `setQuantity(formData)` in `src/app/actions.ts`: reads `productId` + `quantity`, clamps to `[1, MAX_QTY]` (MAX_QTY e.g. 20), writes the basket, redirects to `/plan`. Extract a pure `clampQuantity(n)` for unit testing.
- The stepper is two submit buttons (− / +) posting `setQuantity` with the adjusted value (server-rendered, no client JS), with the current `n` displayed between them. Re-uses the same form pattern as `removeFromPlan`.
- `addToPlan` keeps incrementing on catalog re-add (unchanged). `parseBasket` already clamps `quantity >= 1`.
- Quantity already flows into `Quote` line + `firmLineTotal` + `ContentBrief`/`PublisherBooking` per line — no change to the submit/quote path.

---

## 4. Sidebar: pricing cleanup

In the summary head (`plan/page.tsx:219-248`):
- Keep the large `.price` figure ONLY for currencies with a visible amount (`r.hasVisible`), with the existing `+ request price` muted suffix when that currency also has hidden-price items.
- For currencies with NO visible amount, do NOT emit a giant `{cur} · Contact for price` line. Instead, when the basket has any hidden-price items, render a **single compact muted line** below the totals: e.g. "Pricing on request — firm quote in 24h" (new key `plan.pricingOnRequest`). Drop the per-currency request-price `.price` rows entirely.
- Net: at most the real-amount figures (one per currency that has them) + one small "pricing on request" note — never three giant "Contact for price" lines.

---

## Testing

- **Pure unit (`src/lib/recommend.test.ts`):** tiering — Tier 1 fills to budget; Tier 2 appended when Tier 1 under-fills; no-price titles excluded from Tier 1 / included in Tier 2; empty market → empty result. `clampQuantity` — below 1 → 1, above max → max, valid passthrough.
- **Catalog where-clause:** a focused test (or extend existing catalog filter coverage) that `vertical: { in: [...] }` is applied when the param is present; distinct-options query returns sorted non-null verticals.
- **Render/integration:** quantity stepper (− at 1 stays 1; + increments), sidebar (mixed visible+hidden → one figure + one "pricing on request"; all-hidden → just the note), and the empty-state recommend panel are verified on **prod/staging** (server-rendered; the repo has no DOM test harness). Note: recommendation richness is currently inventory-limited (sparse firm prices) — Tier 2 ensures the panel still populates.

## Out of scope (this spec)

- Semantic / free-text brief matching (decided: budget+market only).
- Confirming more titles' firm pricing (data/ops, not code) — the reason Tier 2 exists.
- Editing the brief fields' set (budget/audience/goal/free-text stay as-is).
- True dark/light theming work beyond what already ships.
