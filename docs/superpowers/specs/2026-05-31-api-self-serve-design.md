# API Self-Serve — the honest answer to "programmatic" — Design Spec

**Date:** 2026-05-31
**Status:** Approved (design); pending spec review
**Sub-project:** 5 of 5 in the SUNT-gap competitive build

## Context

SUNT markets "programmatic / DSP buying." NativeSpin is a managed marketplace
selling placements on **named** premium titles — there is no auction, no RTB,
no DSP, and building one would contradict the model and be a false claim.

The honest competitive answer is the capability NativeSpin *already* leans on in
its own copy: "Make native inventory as easy to find, compare and buy as
programmatic display — without losing the editorial quality." That means the
**public catalog API + self-serve FIRM checkout**. This sub-project surfaces
that story and closes the one real gap: the API is read-only today, so you can
*discover* via API but not *buy* via API.

Decisions locked during brainstorming:

- **No DSP/auction.** Reframe "programmatic" as API + self-serve.
- **Build the real write endpoint:** `POST /api/v1/orders` (FIRM-only),
  reusing the existing FIRM checkout logic, so "buy via API" is true.

## Grounding (current state, verified)

- Public read API exists: `/api/v1/catalog/titles`, `/api/v1/catalog/titles/[id]`,
  `/api/v1/publisher/products`, `/api/v1/quotes/[id]`; `ApiKey` model with
  SHA-256 token hash + scopes (`catalog:read`), `PartnerWebhook` for catalog
  events; OpenAPI at `/api/openapi.json`.
- Self-serve FIRM checkout exists in the UI via `submitRequest`/the FIRM path in
  `src/app/actions.ts` (FIRM-only products → Quote+Order with no desk review,
  availability-checked, org-scoped, rate-limited).
- `ApiKey.scopes` is a comma-separated string; only `catalog:read` used today.
- Marketing `/api` page + `apiDocs` i18n namespace exist.

## 1. `POST /api/v1/orders` (the real build)

- New route `src/app/api/v1/orders/route.ts`. Authenticated by API key
  (existing key-auth helper); requires a new `orders:write` scope on the key
  (additive to the scopes string; key issuance tool updated to allow it).
- Body: `{ items: [{ productId, quantity }], reference? }`. Pure validator
  `parseOrderRequest(body)` in `src/lib/api/order-request.ts` (unit-tested):
  non-empty items, positive integer quantities, dedupe.
- Order creation **reuses the existing FIRM checkout core** — extract the
  current FIRM Quote+Order logic from `actions.ts` into a shared
  `createFirmOrder({ orgId, items })` in `src/lib/commerce/firm-order.ts` so the
  UI action and the API endpoint call the identical path (DRY; no divergent
  pricing). Guards: every product must be FIRM-visible, active, bookable, and
  available; the API key's org is the buyer; cross-market split handled exactly
  as the UI does.
- FIRM-only: any non-FIRM product id → 422 with a clear message ("RFQ-only —
  use the desk"). Rate-limited (reuse `rfqLimiter` pattern with an
  `api-order:<orgId>` key). Audited (`recordAudit`). Returns the created
  order(s) summary as JSON.
- OpenAPI (`/api/openapi.json`) updated with the new endpoint + `orders:write`.

> Refactor note: extracting `createFirmOrder` is in-scope cleanup of the file
> we're touching (`actions.ts` FIRM path), not unrelated refactoring — it's
> required to avoid a second copy of order-creation logic.

## 2. Marketing / docs

- Extend the `/api` marketing page (and a short block on `/for-agencies`) with
  an "API & self-serve" section: catalog API for discovery, FIRM products for
  instant booking, `orders:write` for programmatic-style buying, webhooks for
  catalog changes. Frame explicitly against the programmatic pitch — "as easy
  to buy as programmatic, on named premium titles."
- Honest boundary: describe it as API-driven self-serve buying of FIRM
  inventory; **do not** call it a DSP, auction, or real-time bidding.
- New/extended `apiDocs` i18n keys across six locales.

## 3. Testing & verification

- node:test (pure): `parseOrderRequest` (valid, empty items, zero/negative qty,
  dedupe), and `createFirmOrder`'s pure guards where extractable (FIRM-only
  rejection logic as a pure predicate).
- `createFirmOrder` extraction verified by existing FIRM-checkout behavior
  staying green (the UI action now calls it) + `pnpm typecheck`/`build`.
- API endpoint: a node:test exercising the validator; endpoint integration
  guarded by typecheck/build (no prisma-mock infra).
- OpenAPI JSON still valid; i18n parity for new apiDocs keys.

## Out of scope

Any auction/RTB/DSP/bidding. Non-FIRM (RFQ) ordering via API (stays desk-mediated
by design). Buyer-facing API key self-management UI (keys remain desk-issued for
now).
