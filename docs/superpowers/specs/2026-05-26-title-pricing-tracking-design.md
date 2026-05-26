# Title pricing tracking — design spec

**Date:** 2026-05-26
**Status:** Draft, pending user review
**Scope:** Catalog pricing freshness, sales-rep outreach workflow, internal price history, buyer-facing "Contact for price" fallback, MCP server for Claude-driven admin

## Problem

Today every `Product` in the Native catalog has a non-null `basePrice` derived from a reach-based blueprint at title-activation time. None of those prices have been confirmed with the publisher's sales team. Admin has no workflow to:

1. See which titles need a price refresh
2. Send pricing requests to sales contacts (per-title or in bulk)
3. Capture structured responses (price, what's included, what's not, native-yes/no)
4. Keep a history of price changes with audit trail
5. Tell the buyer "we don't have a confirmed price yet — contact us" instead of showing an unconfirmed estimate

There is also no programmatic surface (MCP) for Claude Code to drive this workflow on the admin's behalf.

## Goals

- Per-product pricing history with explicit "applied to live" event
- Per-publisher many-to-many sales contacts
- Magic-link form for sales reps to self-serve price updates (with manual-log fallback for reps who'd rather email back)
- Bulk + per-title outreach from the desk UI
- Buyer-facing fallback: when price isn't confirmed, show description + "Contact for price"
- MCP server exposing the same actions Claude Code can drive

## Non-goals (v1)

- Reminder emails on pending requests (manual resend only)
- Bulk "apply all pending quotes" (per-quote review forces eyeballs)
- IMAP polling to auto-detect email replies
- Versioned audit on `SalesContact` edits — only on the price flow
- Migrating the existing `Title.adSales` CSV string into the new `SalesContact` rows (kept as deprecated, admin curates manually)

## Decisions taken during brainstorm

- **Sales contact model:** many-to-many `SalesContact` entity linked to titles via join table; primary contact flag
- **Reply mechanism:** magic-link form is the happy path, admin manual-log is the realistic path (most reps won't log in)
- **Price granularity:** per-product (matches existing `Product` model)
- **Apply policy:** received quotes never auto-apply; admin clicks Apply to commit to `Product.basePrice` + `confirmedAt`
- **Outreach trigger:** per-title button + bulk action; no cron in v1
- **Unknown-price model:** keep `Product.basePrice` non-null (blueprint estimate retained for internal desk use); add `confirmedAt` + `confirmedSource` fields; buyer-facing hides when `confirmedAt = null`
- **Backfill:** all existing products migrate with `confirmedAt = NULL` — honest from day one, admin re-confirms on their own cadence
- **MCP placement:** embedded `/api/mcp` route in the Next.js app, authenticated via existing `ApiKey` table with new `pricing:admin` scope
- **Extended `ProductType`:** add `CONTEXTUAL` and `OTHER` to support contextual placements and arbitrary new formats (newsletter takeover, podcast, etc.)
- **`PriceQuote` supports drafts:** a quote can reference an existing `productId` OR carry draft-product fields for net-new formats; Apply creates the Product

---

## 1. Data model

### New entities

```prisma
model SalesContact {
  id           String   @id @default(cuid())
  publisherId  String
  publisher    Publisher @relation(fields: [publisherId], references: [id])
  name         String
  email        String
  phone        String?
  role         String?  // e.g. "Head of Native Sales"
  notes        String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  titles       SalesContactTitle[]
  requests     PriceRequest[]

  @@unique([publisherId, email])
  @@index([publisherId])
}

model SalesContactTitle {
  salesContactId String
  salesContact   SalesContact @relation(fields: [salesContactId], references: [id], onDelete: Cascade)
  titleId        String
  title          Title        @relation(fields: [titleId], references: [id], onDelete: Cascade)
  isPrimary      Boolean      @default(false)
  createdAt      DateTime     @default(now())

  @@id([salesContactId, titleId])
  @@index([titleId])
  // Partial unique index in raw SQL to enforce "one primary per title"
  // — see migration for: CREATE UNIQUE INDEX ... WHERE "isPrimary" = true
}

enum PriceResponseSource {
  LINK_FORM
  MANUAL_EMAIL
  MANUAL_PHONE
  MANUAL_OTHER
}

model PriceRequest {
  id              String   @id @default(cuid())
  titleId         String
  title           Title    @relation(fields: [titleId], references: [id])
  salesContactId  String
  salesContact    SalesContact @relation(fields: [salesContactId], references: [id])
  token           String   @unique          // CSPRNG, 32+ chars
  expiresAt       DateTime                  // default now + 30d
  sentAt          DateTime?                 // null until email actually goes out
  openedAt        DateTime?                 // set on first GET of /price-request/[token]
  respondedAt     DateTime?                 // form submit OR admin logged response
  cancelledAt    DateTime?                  // admin cancelled before response
  responseSource  PriceResponseSource?
  responseNote    String?                   // rep's free-text OR admin's transcription
  hasNative       Boolean?                  // null = "didn't say"
  requestedById   String
  requestedBy     User     @relation("PriceRequestRequester", fields: [requestedById], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  quotes          PriceQuote[]

  @@index([titleId])
  @@index([salesContactId])
  @@index([respondedAt])
}

model PriceQuote {
  id               String   @id @default(cuid())
  priceRequestId   String?                   // nullable: admin can log free-standing
  priceRequest     PriceRequest? @relation(fields: [priceRequestId], references: [id])

  // Either references an existing Product OR carries draft fields
  productId        String?
  product          Product? @relation(fields: [productId], references: [id])
  draftProductType ProductType?
  draftProductName String?
  draftProductDesc String?

  price            Decimal  @db.Decimal(12, 2)
  currency         String                    // ISO 4217
  includedText     String?
  excludedText     String?
  validUntil       DateTime?

  // Apply-to-live state
  appliedAt        DateTime?
  appliedById      String?
  appliedBy        User?    @relation("PriceQuoteApplier", fields: [appliedById], references: [id])
  rejectedAt       DateTime?
  rejectedById     String?
  rejectedReason   String?

  recordedAt       DateTime @default(now())
  recordedById     String                    // who logged it (admin user or apikey:<id>)

  @@index([productId])
  @@index([priceRequestId])
  @@index([appliedAt])
  // Database-level XOR: either productId or draft fields, never both, never neither.
  // Enforced in raw SQL CHECK constraint in migration.
}
```

### Changes to existing models

```prisma
enum ProductType {
  NATIVE_ARTICLE
  ADVERTORIAL
  NATIVE_DISPLAY
  PACKAGE
  CONTEXTUAL  // new
  OTHER       // new — catch-all for newsletter takeover, podcast, video, etc.
}

model Product {
  // ...existing fields...
  confirmedAt     DateTime?
  confirmedSource String?  // e.g. "PriceQuote:abc123", "manual", "blueprint-legacy"
}

model ApiKey {
  // existing schema — no shape change. Just expanding the documented scopes:
  //   catalog:read   — current
  //   pricing:admin  — new, required for MCP mutation tools
}

model Title {
  adSales String? // CSV "Ad Sales" — DEPRECATED: superseded by SalesContact join
  // Field kept to preserve CSV import lineage; not migrated automatically.
}
```

### Backfill (migration)

- Add new tables + new `Product` columns
- `UPDATE Product SET confirmedAt = NULL, confirmedSource = NULL` (default behavior, but stated explicitly so it's audit-visible)
- `ALTER TYPE ProductType ADD VALUE 'CONTEXTUAL'`, `ADD VALUE 'OTHER'`
- Add partial unique index for "one primary contact per title":
  ```sql
  CREATE UNIQUE INDEX "SalesContactTitle_one_primary_per_title"
    ON "SalesContactTitle"("titleId") WHERE "isPrimary" = true;
  ```
- Add CHECK constraint on `PriceQuote`:
  ```sql
  ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_product_xor_draft"
    CHECK (
      ("productId" IS NOT NULL AND "draftProductType" IS NULL)
      OR
      ("productId" IS NULL AND "draftProductType" IS NOT NULL AND "draftProductName" IS NOT NULL)
    );
  ```

---

## 2. Library layer (`src/lib/pricing/`)

All business logic lives here. Server actions and MCP tools are thin wrappers.

- `src/lib/pricing/contacts.ts` — `createContact`, `attachToTitle`, `setPrimary`, `detach`, `listForTitle`, `listForPublisher`
- `src/lib/pricing/requests.ts` — `createRequest`, `createRequestsBulk` (groups by primary contact, skips titles with no primary, returns skip list), `sendEmail`, `markOpened`, `cancel`, `resend`, `findByToken`
- `src/lib/pricing/quotes.ts` — `logQuoteFromForm` (validates token, transaction-creates quotes, marks request responded), `logQuoteManually` (admin transcribing), `applyQuote` (creates Product from draft if needed, copies to `Product.basePrice` + `confirmedAt`, records audit), `rejectQuote`, `editPendingQuote`
- `src/lib/pricing/freshness.ts` — `titlesNeedingCheck({ marketCode?, publisherId?, olderThanDays })`, `latestConfirmedAt(titleId)`, `pendingResponseCount`, `pendingApplyCount`
- `src/lib/pricing/email.ts` — outreach email template (subject + body per locale), reply-to logic, integration with `emailAdapter` from `src/lib/notify.ts`
- `src/lib/pricing/tokens.ts` — CSPRNG token generation (mirrors `src/lib/publisher-invite.ts`)
- `src/lib/pricing/visibility.ts` — *extends* existing `src/lib/pricing-visibility.ts`; adds `isProductPriceShown(product, title)` that combines existing `arePricesVisible` with `product.confirmedAt !== null && product.active`

Every mutation in this layer calls `recordAudit(actorId, action, target, payload)` from `src/lib/audit.ts`. Actor is either a user ID (desk UI) or `apikey:<id>` (MCP).

Files stay small and single-purpose. None should exceed ~250 lines.

---

## 3. Server actions (desk UI)

Located in `src/app/price-actions.ts` (new). Existing `src/app/title-actions.ts` keeps its activation/visibility actions; the new file is for pricing-specific flows.

- Contact actions: `createSalesContactAction`, `attachContactAction`, `setPrimaryContactAction`, `detachContactAction`
- Request actions: `createPriceRequestAction`, `createPriceRequestsBulkAction`, `sendPriceRequestAction`, `cancelPriceRequestAction`, `resendPriceRequestAction`, `logManualResponseAction`
- Quote actions: `applyQuoteAction`, `rejectQuoteAction`, `editPendingQuoteAction`

All require `SUPERADMIN` (same gate as existing title-actions). Each is a thin wrapper:

```ts
"use server";
export async function applyQuoteAction(formData: FormData) {
  const userId = await requireSuperadmin(locale);
  const quoteId = field(formData, "quoteId");
  await applyQuote({ quoteId, actorUserId: userId });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}
```

---

## 4. Desk UI

### `/[locale]/desk/titles` (existing — additions)

- New column: "Price freshness" — latest `confirmedAt` across the title's products, rendered as "12 days ago" / "—" / "Never"
- Filter chips: `Stale (>90d)` · `Never confirmed` · `Pending response` · `Pending apply`
- Bulk action toolbar (appears when rows selected): `Send price request to selected` → modal preview ("12 titles → 4 emails to 4 reps; 2 titles have no primary contact and will be skipped") → confirm

### `/[locale]/desk/titles/[id]` (existing — three new panels)

1. **Sales contacts panel**
   - List of attached `SalesContact`s with name, email, phone, primary star
   - `Add contact` (creates new SalesContact under this title's publisher + attaches)
   - `Attach existing` (searches publisher's existing contacts)
   - Star toggles primary (enforced by partial unique index)

2. **Price requests panel**
   - Table of recent requests, newest first
   - Status badges: `Draft` · `Sent` · `Opened` · `Responded` · `Expired` · `Cancelled`
   - Per row: `Resend` · `Cancel` · `Log response manually` (opens transcription form)

3. **Pending quotes panel**
   - Each pending quote shown as a side-by-side card:
     - Left: `Current live price: €X (confirmed Mar 12 by jane@)` (from `Product.basePrice` + `confirmedAt` + audit lookup)
     - Right: `Latest quote: €Y (received May 26 via link form)` + included/excluded/validUntil
   - Buttons: `Apply` · `Reject (with reason)` · `Edit before applying`

### `/[locale]/desk/price-quotes` (new)

Cross-title queue. Same per-row affordances as panel B3. Filters: market, publisher. Lets admin process a batch of pending applies in one sitting without clicking through each title page.

### Apply / multiple pending quotes per product

If two quotes for the same product are pending (e.g., rep submitted via link AND admin transcribed a phone call), Applying one does NOT auto-reject the other. Both stay visible until admin acts on each. This is by design — admin should see "two prices came in, I'm choosing this one" rather than have the system silently discard. The non-applied quote can be Rejected (with reason) or left pending if the admin wants to revisit.

---

## 5. Magic-link form (`/[locale]/price-request/[token]`)

Public route, no auth, locale derived from title's market. Token lifecycle mirrors `PublisherInvite` (30-day expiry, single-use for submitting, multi-use for viewing).

### Form structure

1. **Header** — "Hi {contact.name}, please confirm pricing for {title.name}." Shows title logo + publisher name (anti-phishing).
2. **Does this title still offer native content?** Radio: `Yes` / `No` / `Not sure`. If `No`, form collapses to a single Send button → `hasNative = false`, no quotes.
3. **Per-product price lines** — one card per active `Product`:
   - Product name + type (read-only)
   - Price + Currency (defaults to market currency)
   - What's included (textarea)
   - What's NOT included (textarea)
   - Valid until (optional date)
   - `Skip — don't quote this one` checkbox
4. **Add another format** button — opens inline card for draft products:
   - Format type dropdown (NATIVE_ARTICLE · ADVERTORIAL · NATIVE_DISPLAY · CONTEXTUAL · PACKAGE · OTHER)
   - Name + Description
   - Same price/currency/included/excluded fields
5. **Free-text note** — maps to `PriceRequest.responseNote`
6. **Submit** — disabled until at least one priced line OR `hasNative = No`

### Submit handler

- Zod validation (price > 0, ISO 4217 currency, at least one answer)
- Single transaction: create `PriceQuote` rows, set `priceRequest.respondedAt`, `responseSource = LINK_FORM`, consume token
- Notify `PriceRequest.requestedBy` (admin who fired the request) via `emailAdapter`
- Redirect to `/[locale]/price-request/[token]/thanks` (idempotent)

### Open-link tracking

`GET` on the page sets `openedAt` on first visit (idempotent), gives admin the funnel signal.

### Failure modes

- Expired token → "This link expired on {date}. Please ask {admin email} for a new one." (no title data leaked)
- Already-responded token → "Thanks, your response was received on {date}." (no form)
- Cancelled token → same as expired
- Title deleted → 404

### No-JS fallback

Form posts to a Server Action — standard App Router pattern, works without JS.

---

## 6. Buyer-facing rendering ("Contact for price")

Extend `src/lib/pricing-visibility.ts`:

```ts
export function isProductPriceShown(
  product: { active: boolean; confirmedAt: Date | null },
  title: TitleWithVisibility,
): boolean {
  if (!product.active) return false;
  if (product.confirmedAt === null) return false;
  return arePricesVisible(title);
}
```

`redactProductPricing` also redacts when `confirmedAt = null`.

### Copy change

Rename buyer-facing `"Request price"` → `"Contact for price"` across all 6 locales (`en/no/sv/da/de/fi`). Both gates (visibility off, confirmedAt null) render the same string — buyers don't need to know which fired.

### Description fallback

When price is hidden, the buyer sees `Product.description` + the "Contact for price" CTA. If `Product.description` is empty, fall back to `Title.audienceNote`. Then nothing (no further chain).

### Surfaces touched

- `/[locale]/catalog` listing
- `/[locale]/catalog/[slug]` detail
- `/[locale]/catalog/compare`
- Public API `/api/v1/catalog/titles/[id]` (already calls `redactProductPricing` — automatic once updated)
- Recommender output

### Self-serve FIRM checkout

Already blocked when `arePricesVisible` is false. Extend the same gate to block when `confirmedAt === null`. Buyer should never check out at a number we haven't confirmed.

---

## 7. MCP server (`/api/mcp`)

Embedded HTTP streamable transport route inside Native's Next.js app. Authenticated via existing `ApiKey` (header `X-API-Key`), scope `pricing:admin` for mutations, `catalog:read` (or `pricing:admin`) for reads.

### Tool surface

**Read tools:**
- `native_list_titles_needing_price_check({ market?, publisherId?, olderThanDays? })`
- `native_get_title({ idOrSlug })` — full details: products, latest quotes, sales contacts
- `native_list_sales_contacts({ publisherId?, titleId? })`
- `native_list_open_price_requests({ market?, olderThanDays? })`
- `native_list_pending_quotes()`
- `native_get_price_history({ productId })`

**Mutation tools:**
- `native_create_sales_contact({ publisherId, name, email, phone?, role?, notes? })`
- `native_attach_sales_contact({ salesContactId, titleId, isPrimary })`
- `native_create_price_request({ titleId, salesContactId, send? })`
- `native_create_price_request_bulk({ titleIds[], send? })` — auto-picks primary contact, returns skip list
- `native_log_quote({ priceRequestId?, productId, price, currency, includedText?, excludedText?, validUntil? })`
- `native_log_quote_draft({ priceRequestId?, draftProductType, draftProductName, draftProductDesc?, price, currency, ... })`
- `native_apply_quote({ quoteId })`
- `native_cancel_price_request({ priceRequestId })`

### Implementation rule

MCP tools are thin wrappers around `src/lib/pricing/*.ts`. **No business logic in the MCP layer.** Both desk UI and MCP go through the same lib functions. This is the only way to guarantee they don't drift.

### Audit

Every MCP mutation records an `Audit` row with `actor: "apikey:<id>"` so we can tell desk-UI changes from Claude-driven ones in post-hoc forensics.

### Out of scope for MCP v1

- Sending raw emails directly (only through `native_create_price_request({ send: true })`)
- Deleting historical quotes (admin-UI only, by design)
- Modifying applied quotes (history is immutable)

---

## 8. Email (`src/lib/pricing/email.ts`)

Outreach email template. Mirrors `inviteEmail` from `src/lib/publisher-invite.ts`.

- **Subject** (localized): "Price check: {title.name}"
- **Body**: greeting → context ("we list {title.name} in our Native catalog and want to make sure our pricing is current") → magic link → fallback ("or just reply to this email with your current rates and we'll log them for you") → signature
- **Locale mapping** via `market.code`: NO → no, SE → sv, DK → da, FI → fi, DE/AT/CH → de, UK/IE → en
- **Adapter**: existing `emailAdapter` from `src/lib/notify.ts`
- **Reply-to**: the admin who fired the request, not a generic inbox — direct replies land with the right person (matches the "publishers are lazy, won't log in" reality)
- **Phishing mitigation**: include title logo + publisher name in body

---

## 9. Testing strategy

Mirrors existing Vitest + Playwright patterns in the repo.

### Unit (Vitest, colocated `*.test.ts`)
- `src/lib/pricing-visibility.test.ts` — extend with `confirmedAt = null → hidden` cases
- `src/lib/pricing/freshness.test.ts` — boundary cases (no products, all confirmed, mixed)
- `src/lib/pricing/quotes.test.ts` — `applyQuote` for existing product, `applyQuote` for draft (creates Product), reject, edit-before-apply, double-apply rejection
- `src/lib/pricing/requests.test.ts` — token uniqueness, expiry, single-use enforcement
- `src/lib/pricing/email.test.ts` — snapshot per locale to catch translation drift

### Integration (Vitest with test DB)
- Full lifecycle: create request → simulate form submit → admin applies → `Product.basePrice` + `confirmedAt` updated, `Audit` row exists
- Bulk: 5 requests across 3 publishers → 3 emails queued (one per primary contact), 2 titles correctly skipped
- MCP: each tool calls into the lib layer; rejects calls without `pricing:admin` scope

### Playwright (one happy-path E2E)
- Admin loads `/desk/titles`, selects 2 titles, clicks "Send price request", sees preview, confirms
- Open magic link in a second browser context, fill form, submit
- Return to admin, see pending quote, click Apply, verify price shows on `/catalog/[slug]`

### MCP manual test (one-time during dev)
- `claude mcp add native --transport http http://localhost:PORT/api/mcp --header "X-API-Key: <test-key>"`
- Run the example workflow end-to-end via Claude Code

### Observability
- All mutations write to existing `Audit` table via `recordAudit`
- `PriceRequest.openedAt` + `respondedAt` give natural funnel metrics (sent → opened → responded → applied), surfaced in panel B2

---

## 10. File-level summary

### New files
- `prisma/migrations/<date>_pricing_tracking/migration.sql`
- `src/lib/pricing/contacts.ts`
- `src/lib/pricing/requests.ts`
- `src/lib/pricing/quotes.ts`
- `src/lib/pricing/freshness.ts`
- `src/lib/pricing/email.ts`
- `src/lib/pricing/tokens.ts`
- `src/lib/pricing/visibility.ts` (consolidates existing `pricing-visibility.ts` + new gate)
- `src/lib/pricing/*.test.ts` (colocated)
- `src/app/price-actions.ts`
- `src/app/[locale]/desk/price-quotes/page.tsx`
- `src/app/[locale]/desk/titles/[id]/_components/SalesContactsPanel.tsx`
- `src/app/[locale]/desk/titles/[id]/_components/PriceRequestsPanel.tsx`
- `src/app/[locale]/desk/titles/[id]/_components/PendingQuotesPanel.tsx`
- `src/app/[locale]/price-request/[token]/page.tsx`
- `src/app/[locale]/price-request/[token]/thanks/page.tsx`
- `src/app/[locale]/price-request/[token]/actions.ts`
- `src/app/api/mcp/route.ts` (HTTP streamable MCP transport)
- `src/lib/mcp/` (tool wiring; tools import from `src/lib/pricing/*`)
- `tests/e2e/pricing-flow.spec.ts`

### Modified files
- `prisma/schema.prisma` (new models + Product fields + ProductType enum values)
- `src/lib/pricing-visibility.ts` (deprecate in favor of `src/lib/pricing/visibility.ts`, re-export for backward compat)
- `src/app/[locale]/desk/titles/page.tsx` (freshness column, filter chips, bulk toolbar)
- `src/app/[locale]/desk/titles/[id]/page.tsx` (mount three new panels)
- `src/app/[locale]/catalog/*` (use new visibility gate)
- `src/app/api/v1/catalog/titles/[id]/route.ts` (no code change — uses redactProductPricing which now also gates on confirmedAt)
- `src/messages/{en,no,sv,da,de,fi}.json` + landing equivalents (rename "Request price" → "Contact for price", add new admin strings)

---

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Migration day surprise — every product flips to "Contact for price" | Pre-migration: announce internally. Post-migration: admin sees a banner on `/desk` with one-click bulk request. Confirmed-source = "blueprint-legacy" left available for any title where admin opts to grandfather the estimate manually. |
| Reps don't respond at all | Acceptable v1. Manual `Resend` button covers the worst case. Reminder cron deferred. |
| Admin transcribes wrong number from email reply | Apply is explicit; pending quote shows side-by-side with current live price. Typos visible before commit. `Edit before applying` lets admin fix in place. |
| MCP tool drifts from desk UI | Architectural rule: all logic in `src/lib/pricing/*`. Both surfaces are thin wrappers. Integration tests cover both paths through the same functions. |
| Token leak (forwarded email) | Single-use submit; token consumed on first valid response. Open-tracking is informational, not authoritative. |
| Net-new draft products pollute catalog | New products from draft quotes are created `active = false`. Admin must explicitly activate (matches existing `markTitleNative` flow). |
| Existing `Title.adSales` CSV string and new `SalesContact` rows drift | `adSales` field is kept but documented as deprecated. Admin curates `SalesContact` rows manually. Can be dropped in a later migration once curation is complete. |

---

## 12. Open questions deferred to implementation

- Exact wording of the localized email subject/body (sample copy will be reviewed during implementation, not specced here)
- Pagination strategy on `/desk/price-quotes` once the queue grows (deferred — start with 50-row limit)
- Whether to expose `PriceRequest.responseNote` to the buyer-facing layer in any form (no for v1; internal only)
