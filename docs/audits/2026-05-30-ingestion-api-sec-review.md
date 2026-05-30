# Security review — publisher ingestion API

Date: 2026-05-30
Scope: the new external write surface — `PUT/GET /api/v1/publisher/products`
and its dependencies: `src/lib/api-auth.ts`, `src/lib/ingest.ts`,
`src/lib/ingest-apply.ts`, `ApiKey.publisherId` / `catalog:write`.

## Critical property: multi-tenant isolation — PASS

A `catalog:write` key is bound to one publisher (`ApiKey.publisherId`). The
route derives `publisherId` from the authenticated key and passes it to
`applyIngestion`; it is **never** read from the request body.

- Title upsert is keyed on `(publisherId, externalRef)` — a key can only
  ever resolve to its own publisher's title.
- Product upsert is keyed on `(titleId, externalRef)` where `titleId` is a
  title we just confirmed/created under this publisher — no cross-publisher
  product hijack.
- New titles are created `active = false` (catalog curation gate); updates
  never flip `active` or `slug`.
- `GET` filters `where: { publisherId }` — a key only reads its own inventory.

Verified by code review and the live smoke test (a key for one publisher
only ever saw/that publisher's smoke title).

## Findings & fixes

### 1. Unbounded work per request — MEDIUM (perf / slow-request DoS) — FIXED
Worst case was 200 products × (title + product + spec + 36 availability
upserts) ≈ 7–8k sequential queries in one request, holding a DB connection.
Rate limiting (20/min/key) bounded frequency but not single-request cost.

Fix: tightened the Zod contract — products `max 100`, availability `max 24`
per product — and wrapped each product's writes in a `prisma.$transaction`
so a mid-product failure rolls back cleanly (better idempotency too). New
worst case ≈ 100 × 27 and atomic per item.

### 2. SSRF via `title.websiteUrl` — LOW (noted, not exploitable today)
Ingestion accepts a publisher-supplied URL (Zod-validated as a URL) stored
on `Title.websiteUrl`. Nothing fetches it automatically; only the manual
`fetch-digital-reach` ops script does, run by staff. If that is ever
automated, add an allowlist / block private ranges first.

### 3. Currency vs. market mismatch — LOW (data quality, not security) — FIXED
A publisher could send `currency` that differs from the market's currency.
The commerce layer always quotes in the *market* currency, so this was
cosmetic, but it produced confusing rows. Fix: `applyIngestion` now skips
(does not write) any product whose `currency` doesn't match its market's
currency and reports the count in the response so the caller can correct it.

## Checks that passed (no change needed)
- Input validation: Zod `.strict()` rejects unknown fields; all strings and
  numbers are length/range-bounded; `basePrice` capped.
- Auth: scope (`catalog:write`) and publisher-binding enforced; revoked /
  expired / bad keys rejected before any DB write.
- No SQL injection surface (Prisma parameterized; no raw SQL in this path).
- Audit: every ingestion records an `AuditLog` row keyed to the API key.
- Webhooks fire in `after()` and never block or fail the request.
