# Phase 4 + Publisher Ingestion + Revenue Model — Design

Date: 2026-05-30
Branch: `feat/phase4-revenue-ingestion`

Three independent subsystems, built in order 1 → 2 → 3 (the revenue model is a
dependency for the revenue side of Phase-4 intelligence; ingestion is independent).

## 1. Revenue model — margin vs content fee (foundational)

**Problem.** Revenue today is *only* inventory margin (`PriceRule.marginPct` ×
`Product.basePrice`). Content production (`ContentBrief`/`ContentAsset`) is
unmonetized, so the "margin vs content fee" emphasis cannot be run or measured.

**Design.**
- New enum `LineKind { INVENTORY, CONTENT_FEE }`. Add `kind LineKind @default(INVENTORY)`
  to `QuoteLine` and `OrderLine`; make their `productId` nullable (content-fee
  lines reference no product). `InvoiceLine` already has no product.
- New desk-owned table `ContentFeeRule { id, marketCode MarketCode?, productType
  ProductType?, currency, greenfieldFee Decimal, adaptationFee Decimal?, active,
  timestamps }`. Most-specific match wins: (productType+market) > productType >
  global. This is *our* service price, kept off `Product` (publisher-editable).
  `adaptationFee` pairs with the existing `ContentAsset.sourceAssetId` lineage.
- `PlanItem` gains `withContent Boolean @default(false)` — per-placement, because
  some buyers bring copy and some want us to produce it.
- `money.ts`: `computeQuoteLines` appends a `CONTENT_FEE` line for each item with
  `withContent`, using the matched rule (greenfield rate by default). Self-serve
  and desk quote paths both honour it.
- `reporting.ts`: `revenueSplit(lines)` → `{ marginRevenue, contentFeeRevenue, ratio }`.
  Margin revenue = Σ over INVENTORY lines of `lineTotal − unitCost×quantity`.
  Content-fee revenue = Σ over CONTENT_FEE line totals. Desk report shows the mix.
- The "emphasis" is operationalized as configurable rules + a realized-split
  report, so the business steers with data instead of a one-time guess.

## 2. Phase 4 optimization loop

- **Benchmarks by title/category** — pure aggregation in `reporting.ts`:
  per title/category → order count, avg margin %, avg order value, win rate
  (quotes ACCEPTED ÷ SENT-or-further), avg lead time. Surfaced on `/desk/reports`.
- **Pricing intelligence** — deterministic `suggestMargin(history, categoryMedian)`:
  the highest observed margin tier whose win rate stayed above a threshold
  (default 0.5); falls back to the category median margin when data is thin
  (< N=5 decided quotes). Advisory only — a suggestion chip in the desk price
  editor / `/desk/titles`. Never auto-applies.
- **Content playbooks** — new table `Playbook { id, productType ProductType?,
  category String?, marketCode MarketCode?, title, angle, structure, doList,
  dontList, exampleHeadlines, active, timestamps }`. Most-specific match surfaces
  on `ContentBrief` creation and can pre-fill brief defaults. Closes the loop:
  benchmarks/pricing inform price; playbooks codify winning content.

## 3. Publisher programmatic ingestion (independent)

- `ApiKey` gains `publisherId String?`; new scope `catalog:write`. A write key is
  bound to exactly one publisher — hard multi-tenant isolation (a key for
  publisher A can never read or write B's inventory).
- `Title` and `Product` gain `externalRef String?` for idempotent upsert keyed on
  `(publisherId, externalRef)` (Title) and `(titleExternalRef, externalRef)` /
  product-level unique within publisher.
- Endpoints:
  - `PUT /api/v1/publisher/products` — Zod-validated batch upsert of
    products/prices/specs/availability for the key's publisher. Same fields the
    manual portal exposes.
  - `GET /api/v1/publisher/products` — read back ingested inventory.
- Curation gate preserved: ingestion may create/update, but a brand-new title
  stays `active = false` until super-admin activation. All writes audited
  (`AuditLog`) and emit the existing partner webhooks. Documented in the OpenAPI
  spec + `docs/publisher-ingestion.md`.

## Cross-cutting

- Branch `feat/phase4-revenue-ingestion`; one commit per subsystem. `main`
  auto-deploys to prod, so no push without explicit approval.
- Every pure helper unit-tested (matches the existing `src/lib/*.test.ts` convention).
- Migrations: `LineKind` + `ContentFeeRule` + line/plan changes (S1); `Playbook`
  (S2); `ApiKey.publisherId` + `externalRef`s (S3).

## Decisions (overridable)

- Content fee is per-`PlanItem` (`withContent`), not per-campaign.
- Default `ContentFeeRule` seeded with placeholder figures; real numbers set by the business.
- Pricing intelligence is advisory, never auto-applied.
