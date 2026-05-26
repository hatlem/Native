# Title Pricing Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build per-product pricing freshness tracking with sales-rep outreach (magic link + manual log), price history with explicit "apply to live" gate, buyer-facing "Contact for price" fallback, and an MCP server so Claude Code can drive the workflow.

**Architecture:** Pure-function library layer at `src/lib/pricing/*` is the single source of truth for business logic. Desk-UI server actions and MCP tools are thin wrappers around it. Schema adds `SalesContact` (M2M to Title), `PriceRequest` (token + lifecycle), and `PriceQuote` (with productId XOR draft fields). Buyer-facing rendering gates on a new `Product.confirmedAt` field. MCP is an embedded `/api/mcp` route reusing the existing `ApiKey` table with a new `pricing:admin` scope.

**Tech Stack:** Next.js 15 App Router + Server Actions, Prisma 6 + PostgreSQL, next-intl for i18n, `node:test` runner via `tsx --test` for unit tests, `@modelcontextprotocol/sdk` for MCP server. Authentication via existing NextAuth setup. Email via existing `emailAdapter` from `src/lib/notify.ts`. Tokens follow the `PublisherInvite` pattern in `src/lib/publisher-invite.ts`.

**Spec:** `docs/superpowers/specs/2026-05-26-title-pricing-tracking-design.md`

---

## File map

**New library files (pure logic + thin DB wrappers, colocated tests):**
- `src/lib/pricing/tokens.ts` + `tokens.test.ts` — CSPRNG token + expiry helpers (mirror of `publisher-invite.ts`)
- `src/lib/pricing/contacts.ts` + `contacts.test.ts` — `SalesContact` CRUD + primary-flag logic
- `src/lib/pricing/requests.ts` + `requests.test.ts` — request creation, bulk grouping, lifecycle guards
- `src/lib/pricing/quotes.ts` + `quotes.test.ts` — log, apply, reject, edit; XOR draft handling
- `src/lib/pricing/freshness.ts` + `freshness.test.ts` — "needs check" queries, age calculations
- `src/lib/pricing/email.ts` + `email.test.ts` — outreach email template per locale
- `src/lib/pricing/visibility.ts` + `visibility.test.ts` — extends existing `pricing-visibility.ts` with `confirmedAt` gate

**New server actions:**
- `src/app/price-actions.ts` — thin wrappers for desk UI

**New desk UI:**
- `src/app/[locale]/desk/titles/[id]/_components/SalesContactsPanel.tsx`
- `src/app/[locale]/desk/titles/[id]/_components/PriceRequestsPanel.tsx`
- `src/app/[locale]/desk/titles/[id]/_components/PendingQuotesPanel.tsx`
- `src/app/[locale]/desk/price-quotes/page.tsx`

**New magic-link form (public):**
- `src/app/[locale]/price-request/[token]/page.tsx`
- `src/app/[locale]/price-request/[token]/actions.ts`
- `src/app/[locale]/price-request/[token]/thanks/page.tsx`

**New MCP server:**
- `src/app/api/mcp/route.ts`
- `src/lib/mcp/server.ts`
- `src/lib/mcp/tools-read.ts`
- `src/lib/mcp/tools-mutate.ts`
- `src/lib/mcp/auth.ts`

**Modified files:**
- `prisma/schema.prisma`
- Migration directories under `prisma/migrations/`
- `src/lib/pricing-visibility.ts` — re-export from new `pricing/visibility.ts` to avoid breaking existing imports
- `src/app/[locale]/desk/titles/page.tsx` — freshness column, filters, bulk toolbar
- `src/app/[locale]/desk/titles/[id]/page.tsx` — mount three new panels
- `src/messages/{en,no,sv,da,de,fi}.json` + landing equivalents
- `src/app/title-actions.ts` — extract `requireSuperadmin` if not already shared

---

## Phase 1 — Schema migrations

### Task 1: Add `confirmedAt` + `confirmedSource` to `Product`, expand `ProductType`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260526280000_product_confirmed_fields/migration.sql`

- [ ] **Step 1: Add new enum values + Product fields in schema**

Edit `prisma/schema.prisma`:

```prisma
enum ProductType {
  NATIVE_ARTICLE
  ADVERTORIAL
  NATIVE_DISPLAY
  PACKAGE
  CONTEXTUAL
  OTHER
}

model Product {
  // ...existing fields, unchanged...
  confirmedAt     DateTime?
  confirmedSource String?   // e.g. "PriceQuote:abc123", "manual", "blueprint-legacy"
}
```

- [ ] **Step 2: Create migration SQL by hand (Postgres enum ADD VALUE can't run inside the same txn as DDL touching the enum)**

Create `prisma/migrations/20260526280000_product_confirmed_fields/migration.sql`:

```sql
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'CONTEXTUAL';
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'OTHER';

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmedSource" TEXT;

-- Honest-from-day-one backfill: all existing products are unconfirmed.
-- This intentionally hides all live prices until admin re-confirms via
-- the new pricing-request workflow.
UPDATE "Product" SET "confirmedAt" = NULL, "confirmedSource" = NULL;
```

- [ ] **Step 3: Apply migration and regenerate client**

Run:
```bash
pnpm prisma migrate dev --name product_confirmed_fields
pnpm prisma generate
```

Expected: migration applies cleanly, `pnpm prisma generate` succeeds, `Product` model now has the two new fields.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260526280000_product_confirmed_fields/
git commit -m "feat(catalog): add Product.confirmedAt + expanded ProductType"
```

---

### Task 2: Add `SalesContact` + `SalesContactTitle` join with partial unique index

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260526281000_sales_contact/migration.sql`

- [ ] **Step 1: Add models to schema**

Append to `prisma/schema.prisma`:

```prisma
model SalesContact {
  id           String   @id @default(cuid())
  publisherId  String
  publisher    Publisher @relation(fields: [publisherId], references: [id], onDelete: Cascade)
  name         String
  email        String
  phone        String?
  role         String?
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
}
```

Add reverse relation to `Publisher`:
```prisma
model Publisher {
  // ...existing...
  salesContacts SalesContact[]
}
```

Add reverse relation to `Title`:
```prisma
model Title {
  // ...existing...
  salesContactLinks SalesContactTitle[]
}
```

- [ ] **Step 2: Generate migration**

Run:
```bash
pnpm prisma migrate dev --name sales_contact --create-only
```

This creates the migration file without applying it, so we can append the partial unique index.

- [ ] **Step 3: Append partial unique index to the generated SQL**

Open the generated `prisma/migrations/20260526281000_sales_contact/migration.sql` (filename will differ — use the just-created one) and append:

```sql
-- One primary sales contact per title (partial unique index, enforced at DB).
CREATE UNIQUE INDEX "SalesContactTitle_one_primary_per_title"
  ON "SalesContactTitle"("titleId") WHERE "isPrimary" = true;
```

- [ ] **Step 4: Apply migration + regenerate client**

```bash
pnpm prisma migrate dev
pnpm prisma generate
```

Expected: migration applies, partial index exists. Verify with:
```bash
pnpm prisma db execute --stdin <<< "\d+ \"SalesContactTitle\""
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(catalog): add SalesContact + SalesContactTitle join"
```

---

### Task 3: Add `PriceRequest` model with token + lifecycle

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260526282000_price_request/migration.sql`

- [ ] **Step 1: Add enum and model**

Append to `prisma/schema.prisma`:

```prisma
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
  token           String   @unique
  expiresAt       DateTime
  sentAt          DateTime?
  openedAt        DateTime?
  respondedAt     DateTime?
  cancelledAt     DateTime?
  responseSource  PriceResponseSource?
  responseNote    String?
  hasNative       Boolean?
  requestedById   String
  requestedBy     User     @relation("PriceRequestRequester", fields: [requestedById], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  quotes          PriceQuote[]

  @@index([titleId])
  @@index([salesContactId])
  @@index([respondedAt])
}
```

Add reverse relations:
```prisma
model Title {
  // ...existing...
  priceRequests PriceRequest[]
}

model User {
  // ...existing...
  priceRequestsRequested PriceRequest[] @relation("PriceRequestRequester")
}
```

- [ ] **Step 2: Generate + apply migration**

```bash
pnpm prisma migrate dev --name price_request
pnpm prisma generate
```

Expected: clean apply.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(catalog): add PriceRequest with token lifecycle"
```

---

### Task 4: Add `PriceQuote` with XOR CHECK constraint

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260526283000_price_quote/migration.sql`

- [ ] **Step 1: Add model**

Append to `prisma/schema.prisma`:

```prisma
model PriceQuote {
  id               String   @id @default(cuid())
  priceRequestId   String?
  priceRequest     PriceRequest? @relation(fields: [priceRequestId], references: [id])

  productId        String?
  product          Product? @relation(fields: [productId], references: [id])
  draftProductType ProductType?
  draftProductName String?
  draftProductDesc String?

  price            Decimal  @db.Decimal(12, 2)
  currency         String
  includedText     String?
  excludedText     String?
  validUntil       DateTime?

  appliedAt        DateTime?
  appliedById      String?
  appliedBy        User?    @relation("PriceQuoteApplier", fields: [appliedById], references: [id])
  rejectedAt       DateTime?
  rejectedById     String?
  rejectedReason   String?

  recordedAt       DateTime @default(now())
  recordedById     String

  @@index([productId])
  @@index([priceRequestId])
  @@index([appliedAt])
}
```

Add reverse relations:
```prisma
model Product {
  // ...existing...
  priceQuotes PriceQuote[]
}

model User {
  // ...existing...
  priceQuotesApplied PriceQuote[] @relation("PriceQuoteApplier")
}
```

- [ ] **Step 2: Generate migration (create-only so we can append the CHECK)**

```bash
pnpm prisma migrate dev --name price_quote --create-only
```

- [ ] **Step 3: Append XOR CHECK constraint**

Open the new migration SQL and append:

```sql
-- XOR: a quote either references an existing product OR carries draft fields, never both, never neither.
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_product_xor_draft"
  CHECK (
    ("productId" IS NOT NULL AND "draftProductType" IS NULL)
    OR
    ("productId" IS NULL AND "draftProductType" IS NOT NULL AND "draftProductName" IS NOT NULL)
  );
```

- [ ] **Step 4: Apply + regenerate**

```bash
pnpm prisma migrate dev
pnpm prisma generate
```

Verify CHECK exists:
```bash
pnpm prisma db execute --stdin <<< "\d+ \"PriceQuote\""
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(catalog): add PriceQuote with XOR product-or-draft check"
```

---

### Task 5: Document `Title.adSales` as deprecated

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Update comment on `adSales` field**

Find the line in `prisma/schema.prisma`:
```prisma
  adSales       String? // CSV "Ad Sales" — who handles ad sales
```

Replace with:
```prisma
  // DEPRECATED — superseded by the SalesContact join (see SalesContactTitle).
  // Kept to preserve CSV import lineage. Will be dropped once admin has
  // finished curating SalesContact rows for every active title.
  adSales       String?
```

- [ ] **Step 2: Commit**

```bash
git add prisma/schema.prisma
git commit -m "docs(catalog): mark Title.adSales as deprecated"
```

---

## Phase 2 — Library layer (pure logic)

### Task 6: `src/lib/pricing/tokens.ts` — CSPRNG token + expiry helpers

**Files:**
- Create: `src/lib/pricing/tokens.ts`
- Test: `src/lib/pricing/tokens.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/pricing/tokens.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newPriceRequestToken,
  expiryFromNow,
  DEFAULT_REQUEST_TTL_DAYS,
  checkRequest,
} from "./tokens";

test("newPriceRequestToken produces url-safe strings >= 32 chars", () => {
  const t = newPriceRequestToken();
  assert.ok(t.length >= 32, `got length ${t.length}`);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
});

test("newPriceRequestToken is unique across many calls", () => {
  const tokens = new Set(Array.from({ length: 1000 }, () => newPriceRequestToken()));
  assert.equal(tokens.size, 1000);
});

test("expiryFromNow uses DEFAULT_REQUEST_TTL_DAYS by default", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const e = expiryFromNow(undefined, now);
  const expected = new Date("2026-01-31T00:00:00Z");
  assert.equal(e.toISOString(), expected.toISOString());
  assert.equal(DEFAULT_REQUEST_TTL_DAYS, 30);
});

test("checkRequest returns null for missing", () => {
  assert.equal(checkRequest(null), null);
  assert.equal(checkRequest(undefined), null);
});

test("checkRequest detects expired", () => {
  const v = checkRequest(
    {
      expiresAt: new Date("2026-01-01"),
      respondedAt: null,
      cancelledAt: null,
    },
    new Date("2026-02-01"),
  );
  assert.deepEqual(v, { ok: false, reason: "expired" });
});

test("checkRequest detects already-responded", () => {
  const v = checkRequest(
    {
      expiresAt: new Date("2027-01-01"),
      respondedAt: new Date("2026-01-15"),
      cancelledAt: null,
    },
    new Date("2026-02-01"),
  );
  assert.deepEqual(v, { ok: false, reason: "responded" });
});

test("checkRequest detects cancelled", () => {
  const v = checkRequest(
    {
      expiresAt: new Date("2027-01-01"),
      respondedAt: null,
      cancelledAt: new Date("2026-01-15"),
    },
    new Date("2026-02-01"),
  );
  assert.deepEqual(v, { ok: false, reason: "cancelled" });
});

test("checkRequest returns ok for live", () => {
  const v = checkRequest(
    {
      expiresAt: new Date("2027-01-01"),
      respondedAt: null,
      cancelledAt: null,
    },
    new Date("2026-02-01"),
  );
  assert.deepEqual(v, { ok: true });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm test -- src/lib/pricing/tokens.test.ts
```

Expected: FAIL ("Cannot find module './tokens'").

- [ ] **Step 3: Implement**

Create `src/lib/pricing/tokens.ts`:

```ts
import { randomBytes } from "node:crypto";

// 24 bytes → ~32 url-safe base64 chars. Strong enough for a single-use
// time-limited link. Same shape as the PublisherInvite token so admins
// only have to learn one pattern.
const TOKEN_BYTES = 24;
export const DEFAULT_REQUEST_TTL_DAYS = 30;

export function newPriceRequestToken(): string {
  return randomBytes(TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function expiryFromNow(
  days: number = DEFAULT_REQUEST_TTL_DAYS,
  now: Date = new Date(),
): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export type RequestShape = {
  expiresAt: Date;
  respondedAt: Date | null;
  cancelledAt: Date | null;
};

export type RequestVerdict =
  | { ok: true }
  | { ok: false; reason: "expired" | "responded" | "cancelled" };

export function checkRequest(
  req: RequestShape | null | undefined,
  now: Date = new Date(),
): RequestVerdict | null {
  if (!req) return null;
  if (req.cancelledAt) return { ok: false, reason: "cancelled" };
  if (req.respondedAt) return { ok: false, reason: "responded" };
  if (req.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

export function priceRequestLink(token: string, locale: string = "en"): string {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
  return `${origin}/${locale}/price-request/${encodeURIComponent(token)}`;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm test -- src/lib/pricing/tokens.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/tokens.ts src/lib/pricing/tokens.test.ts
git commit -m "feat(pricing): token helpers + request lifecycle guard"
```

---

### Task 7: `src/lib/pricing/visibility.ts` — extend visibility with `confirmedAt` gate

**Files:**
- Create: `src/lib/pricing/visibility.ts`
- Create: `src/lib/pricing/visibility.test.ts`
- Modify: `src/lib/pricing-visibility.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/pricing/visibility.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isProductPriceShown,
  redactProductPricing,
} from "./visibility";

const visibleTitle = { pricesPublic: true, publisher: { pricesPublic: true } };
const hiddenTitle = { pricesPublic: false, publisher: { pricesPublic: true } };

test("isProductPriceShown requires active product", () => {
  assert.equal(
    isProductPriceShown({ active: false, confirmedAt: new Date() }, visibleTitle),
    false,
  );
});

test("isProductPriceShown requires confirmedAt non-null", () => {
  assert.equal(
    isProductPriceShown({ active: true, confirmedAt: null }, visibleTitle),
    false,
  );
});

test("isProductPriceShown requires title visibility", () => {
  assert.equal(
    isProductPriceShown({ active: true, confirmedAt: new Date() }, hiddenTitle),
    false,
  );
});

test("isProductPriceShown returns true when all three gates pass", () => {
  assert.equal(
    isProductPriceShown({ active: true, confirmedAt: new Date() }, visibleTitle),
    true,
  );
});

test("redactProductPricing redacts when confirmedAt is null", () => {
  const product = {
    basePrice: "1000",
    currency: "EUR",
    visibility: "FIRM",
    active: true,
    confirmedAt: null,
  };
  const out = redactProductPricing(product, visibleTitle);
  assert.equal(out.basePrice, null);
  assert.equal(out.visibility, "INDICATIVE");
  assert.equal(out.priceVisible, false);
  assert.equal(out.currency, "EUR");
});

test("redactProductPricing keeps price when confirmed + visible", () => {
  const product = {
    basePrice: "1000",
    currency: "EUR",
    visibility: "FIRM",
    active: true,
    confirmedAt: new Date(),
  };
  const out = redactProductPricing(product, visibleTitle);
  assert.equal(out.basePrice, "1000");
  assert.equal(out.priceVisible, true);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm test -- src/lib/pricing/visibility.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/pricing/visibility.ts`:

```ts
// Buyer-facing price visibility — single source of truth for "should
// the advertiser see a € figure for this product?". Three gates, ANDed:
//   1. Product is active
//   2. Product has been confirmedAt by sales (not just blueprint-estimated)
//   3. Publisher AND title both have pricesPublic = true
//
// This replaces the older src/lib/pricing-visibility.ts which only
// covered gate 3. The old module re-exports from here for back-compat.

export type TitleWithVisibility = {
  pricesPublic?: boolean | null;
  publisher?: { pricesPublic?: boolean | null } | null;
};

export function arePricesVisible(title: TitleWithVisibility): boolean {
  const titleOn = title.pricesPublic ?? true;
  const publisherOn = title.publisher?.pricesPublic ?? true;
  return titleOn && publisherOn;
}

export function allPricesVisible(titles: TitleWithVisibility[]): boolean {
  return titles.every(arePricesVisible);
}

export function anyHiddenPrices(titles: TitleWithVisibility[]): boolean {
  return titles.some((t) => !arePricesVisible(t));
}

export type ProductWithConfirmation = {
  active: boolean;
  confirmedAt: Date | null;
};

export function isProductPriceShown(
  product: ProductWithConfirmation,
  title: TitleWithVisibility,
): boolean {
  if (!product.active) return false;
  if (product.confirmedAt === null) return false;
  return arePricesVisible(title);
}

export function redactProductPricing<
  T extends {
    basePrice?: unknown;
    currency?: string;
    visibility?: string;
    active?: boolean;
    confirmedAt?: Date | null;
  },
>(product: T, title: TitleWithVisibility): T & { priceVisible: boolean } {
  const shown = isProductPriceShown(
    { active: product.active ?? true, confirmedAt: product.confirmedAt ?? null },
    title,
  );
  if (shown) return { ...product, priceVisible: true };
  return {
    ...product,
    basePrice: null,
    visibility: "INDICATIVE",
    priceVisible: false,
  };
}
```

- [ ] **Step 4: Update old module to re-export**

Replace contents of `src/lib/pricing-visibility.ts` with:

```ts
// DEPRECATED location — the implementation moved to src/lib/pricing/visibility.ts
// when the confirmedAt gate was added. This file re-exports so existing
// imports keep working; new code should import from "@/lib/pricing/visibility".
export {
  arePricesVisible,
  allPricesVisible,
  anyHiddenPrices,
  redactProductPricing,
  isProductPriceShown,
  type TitleWithVisibility,
  type ProductWithConfirmation,
} from "./pricing/visibility";
```

- [ ] **Step 5: Run all tests — both new and old visibility tests should pass**

```bash
pnpm test -- src/lib/pricing/visibility.test.ts src/lib/pricing-visibility.test.ts
```

Expected: all tests pass. The old test signature for `redactProductPricing(product, true)` will fail — open `src/lib/pricing-visibility.test.ts` and update the two existing `redactProductPricing` cases to pass a title object instead:

Replace:
```ts
const visible = redactProductPricing(
  { basePrice: "1000", currency: "EUR", visibility: "FIRM", name: "X" },
  true,
);
```

With:
```ts
const visible = redactProductPricing(
  { basePrice: "1000", currency: "EUR", visibility: "FIRM", name: "X", active: true, confirmedAt: new Date() },
  { pricesPublic: true, publisher: { pricesPublic: true } },
);
```

And the `hidden` case:
```ts
const hidden = redactProductPricing(
  { basePrice: "1000", currency: "EUR", visibility: "FIRM", name: "X", active: true, confirmedAt: new Date() },
  { pricesPublic: false, publisher: { pricesPublic: true } },
);
```

- [ ] **Step 6: Re-run tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pricing/visibility.ts src/lib/pricing/visibility.test.ts src/lib/pricing-visibility.ts src/lib/pricing-visibility.test.ts
git commit -m "feat(pricing): visibility gate now requires Product.confirmedAt"
```

---

### Task 8: `src/lib/pricing/freshness.ts` — "needs check" queries + status helpers

**Files:**
- Create: `src/lib/pricing/freshness.ts`
- Test: `src/lib/pricing/freshness.test.ts`

- [ ] **Step 1: Write failing tests for the pure helpers**

Create `src/lib/pricing/freshness.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  latestConfirmedAtAcrossProducts,
  ageInDays,
  freshnessBucket,
} from "./freshness";

test("latestConfirmedAtAcrossProducts returns null when none confirmed", () => {
  assert.equal(
    latestConfirmedAtAcrossProducts([{ confirmedAt: null }, { confirmedAt: null }]),
    null,
  );
});

test("latestConfirmedAtAcrossProducts returns most recent", () => {
  const a = new Date("2026-01-01");
  const b = new Date("2026-05-01");
  const result = latestConfirmedAtAcrossProducts([
    { confirmedAt: a },
    { confirmedAt: null },
    { confirmedAt: b },
  ]);
  assert.equal(result?.toISOString(), b.toISOString());
});

test("ageInDays computes whole-day diff", () => {
  const now = new Date("2026-05-26T12:00:00Z");
  const past = new Date("2026-05-01T12:00:00Z");
  assert.equal(ageInDays(past, now), 25);
});

test("ageInDays returns null when input is null", () => {
  assert.equal(ageInDays(null, new Date()), null);
});

test("freshnessBucket categorises by age", () => {
  const now = new Date("2026-05-26T00:00:00Z");
  assert.equal(freshnessBucket(null, now), "never");
  assert.equal(freshnessBucket(new Date("2026-05-20"), now), "fresh");
  assert.equal(freshnessBucket(new Date("2026-03-01"), now), "aging");
  assert.equal(freshnessBucket(new Date("2026-01-01"), now), "stale");
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
pnpm test -- src/lib/pricing/freshness.test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/pricing/freshness.ts`:

```ts
import { prisma } from "@/lib/prisma";
import type { MarketCode } from "@prisma/client";

// Pure helpers — testable without Prisma.

export function latestConfirmedAtAcrossProducts(
  products: Array<{ confirmedAt: Date | null }>,
): Date | null {
  let latest: Date | null = null;
  for (const p of products) {
    if (!p.confirmedAt) continue;
    if (!latest || p.confirmedAt.getTime() > latest.getTime()) {
      latest = p.confirmedAt;
    }
  }
  return latest;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function ageInDays(when: Date | null, now: Date = new Date()): number | null {
  if (!when) return null;
  return Math.floor((now.getTime() - when.getTime()) / DAY_MS);
}

export type FreshnessBucket = "never" | "fresh" | "aging" | "stale";

export function freshnessBucket(
  confirmedAt: Date | null,
  now: Date = new Date(),
): FreshnessBucket {
  const age = ageInDays(confirmedAt, now);
  if (age === null) return "never";
  if (age <= 30) return "fresh";
  if (age <= 90) return "aging";
  return "stale";
}

// DB-backed query: titles that need a price refresh by age cutoff.
// Returns title id + name + market code + age in days, ordered oldest first.
export async function titlesNeedingCheck(args: {
  marketCode?: MarketCode;
  publisherId?: string;
  olderThanDays: number;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    name: string;
    slug: string;
    marketCode: MarketCode;
    publisherName: string;
    latestConfirmedAt: Date | null;
    ageDays: number | null;
  }>
> {
  const titles = await prisma.title.findMany({
    where: {
      active: true,
      ...(args.marketCode ? { market: { code: args.marketCode } } : {}),
      ...(args.publisherId ? { publisherId: args.publisherId } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      market: { select: { code: true } },
      publisher: { select: { name: true } },
      products: { select: { confirmedAt: true } },
    },
  });

  const now = new Date();
  const cutoffMs = args.olderThanDays * DAY_MS;

  return titles
    .map((t) => {
      const latest = latestConfirmedAtAcrossProducts(t.products);
      const age = ageInDays(latest, now);
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        marketCode: t.market.code,
        publisherName: t.publisher.name,
        latestConfirmedAt: latest,
        ageDays: age,
      };
    })
    .filter((t) => {
      if (t.latestConfirmedAt === null) return true; // never confirmed → always needs check
      return now.getTime() - t.latestConfirmedAt.getTime() >= cutoffMs;
    })
    .sort((a, b) => {
      // never-confirmed first; then oldest age first
      if (a.latestConfirmedAt === null && b.latestConfirmedAt === null) return 0;
      if (a.latestConfirmedAt === null) return -1;
      if (b.latestConfirmedAt === null) return 1;
      return a.latestConfirmedAt.getTime() - b.latestConfirmedAt.getTime();
    })
    .slice(0, args.limit ?? 200);
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm test -- src/lib/pricing/freshness.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/freshness.ts src/lib/pricing/freshness.test.ts
git commit -m "feat(pricing): freshness helpers + titlesNeedingCheck query"
```

---

### Task 9: `src/lib/pricing/contacts.ts` — SalesContact CRUD

**Files:**
- Create: `src/lib/pricing/contacts.ts`
- Test: `src/lib/pricing/contacts.test.ts`

- [ ] **Step 1: Write tests for pure helpers**

Create `src/lib/pricing/contacts.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPrimaryContact, normaliseEmail } from "./contacts";

test("normaliseEmail lowercases and trims", () => {
  assert.equal(normaliseEmail("  Jane@Foo.COM  "), "jane@foo.com");
});

test("pickPrimaryContact prefers isPrimary=true", () => {
  const contacts = [
    { id: "a", isPrimary: false },
    { id: "b", isPrimary: true },
    { id: "c", isPrimary: false },
  ];
  assert.equal(pickPrimaryContact(contacts)?.id, "b");
});

test("pickPrimaryContact falls back to first when no primary set", () => {
  const contacts = [
    { id: "a", isPrimary: false },
    { id: "b", isPrimary: false },
  ];
  assert.equal(pickPrimaryContact(contacts)?.id, "a");
});

test("pickPrimaryContact returns null for empty", () => {
  assert.equal(pickPrimaryContact([]), null);
});
```

- [ ] **Step 2: Run — verify FAIL**

- [ ] **Step 3: Implement**

Create `src/lib/pricing/contacts.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function pickPrimaryContact<T extends { id: string; isPrimary: boolean }>(
  contacts: T[],
): T | null {
  if (contacts.length === 0) return null;
  return contacts.find((c) => c.isPrimary) ?? contacts[0];
}

export async function createSalesContact(args: {
  publisherId: string;
  name: string;
  email: string;
  phone?: string;
  role?: string;
  notes?: string;
  actorId: string;
}) {
  const contact = await prisma.salesContact.create({
    data: {
      publisherId: args.publisherId,
      name: args.name.trim(),
      email: normaliseEmail(args.email),
      phone: args.phone?.trim() || null,
      role: args.role?.trim() || null,
      notes: args.notes?.trim() || null,
    },
  });
  await recordAudit(args.actorId, "sales_contact.create", `SalesContact:${contact.id}`, {
    publisherId: args.publisherId,
    email: contact.email,
  });
  return contact;
}

export async function attachContactToTitle(args: {
  salesContactId: string;
  titleId: string;
  isPrimary?: boolean;
  actorId: string;
}) {
  // If making primary, demote any existing primary first (partial unique
  // index would otherwise reject the insert).
  if (args.isPrimary) {
    await prisma.salesContactTitle.updateMany({
      where: { titleId: args.titleId, isPrimary: true },
      data: { isPrimary: false },
    });
  }
  const link = await prisma.salesContactTitle.upsert({
    where: {
      salesContactId_titleId: {
        salesContactId: args.salesContactId,
        titleId: args.titleId,
      },
    },
    create: {
      salesContactId: args.salesContactId,
      titleId: args.titleId,
      isPrimary: args.isPrimary ?? false,
    },
    update: { isPrimary: args.isPrimary ?? false },
  });
  await recordAudit(args.actorId, "sales_contact.attach", `Title:${args.titleId}`, {
    salesContactId: args.salesContactId,
    isPrimary: link.isPrimary,
  });
  return link;
}

export async function setPrimaryContact(args: {
  salesContactId: string;
  titleId: string;
  actorId: string;
}) {
  return attachContactToTitle({
    salesContactId: args.salesContactId,
    titleId: args.titleId,
    isPrimary: true,
    actorId: args.actorId,
  });
}

export async function detachContactFromTitle(args: {
  salesContactId: string;
  titleId: string;
  actorId: string;
}) {
  await prisma.salesContactTitle.delete({
    where: {
      salesContactId_titleId: {
        salesContactId: args.salesContactId,
        titleId: args.titleId,
      },
    },
  });
  await recordAudit(args.actorId, "sales_contact.detach", `Title:${args.titleId}`, {
    salesContactId: args.salesContactId,
  });
}

export async function listContactsForTitle(titleId: string) {
  const rows = await prisma.salesContactTitle.findMany({
    where: { titleId },
    include: { salesContact: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    ...r.salesContact,
    isPrimary: r.isPrimary,
  }));
}

export async function listContactsForPublisher(publisherId: string) {
  return prisma.salesContact.findMany({
    where: { publisherId },
    orderBy: { name: "asc" },
  });
}
```

- [ ] **Step 4: Run — verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/contacts.ts src/lib/pricing/contacts.test.ts
git commit -m "feat(pricing): SalesContact CRUD + primary-contact logic"
```

---

### Task 10: `src/lib/pricing/email.ts` — localized outreach email template

**Files:**
- Create: `src/lib/pricing/email.ts`
- Test: `src/lib/pricing/email.test.ts`

- [ ] **Step 1: Write failing snapshot tests per locale**

Create `src/lib/pricing/email.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPriceRequestEmail, localeForMarketCode } from "./email";

test("localeForMarketCode maps Nordic + DACH + UK markets", () => {
  assert.equal(localeForMarketCode("NO"), "no");
  assert.equal(localeForMarketCode("SE"), "sv");
  assert.equal(localeForMarketCode("DK"), "da");
  assert.equal(localeForMarketCode("FI"), "fi");
  assert.equal(localeForMarketCode("DE"), "de");
  assert.equal(localeForMarketCode("AT"), "de");
  assert.equal(localeForMarketCode("CH"), "de");
  assert.equal(localeForMarketCode("UK"), "en");
  assert.equal(localeForMarketCode("IE"), "en");
});

test("buildPriceRequestEmail includes title name + link + contact name", () => {
  const m = buildPriceRequestEmail({
    locale: "en",
    contactName: "Jane Doe",
    titleName: "Aftenposten",
    publisherName: "Schibsted",
    link: "https://native.app/en/price-request/abc123",
    inviterName: "Andreas",
  });
  assert.match(m.subject, /Aftenposten/);
  assert.match(m.text, /Jane Doe/);
  assert.match(m.text, /Aftenposten/);
  assert.match(m.text, /Schibsted/);
  assert.match(m.text, /abc123/);
  assert.match(m.text, /Andreas/);
});

test("buildPriceRequestEmail produces a Norwegian variant", () => {
  const m = buildPriceRequestEmail({
    locale: "no",
    contactName: "Jane",
    titleName: "Aftenposten",
    publisherName: "Schibsted",
    link: "https://native.app/no/price-request/x",
    inviterName: "Andreas",
  });
  assert.match(m.subject, /Prisjekk/);
});

test("buildPriceRequestEmail produces a German variant", () => {
  const m = buildPriceRequestEmail({
    locale: "de",
    contactName: "Jane",
    titleName: "FAZ",
    publisherName: "Fazit-Stiftung",
    link: "https://native.app/de/price-request/x",
    inviterName: "Andreas",
  });
  assert.match(m.subject, /Preisabfrage/);
});
```

- [ ] **Step 2: Run — verify FAIL**

- [ ] **Step 3: Implement**

Create `src/lib/pricing/email.ts`:

```ts
import type { MarketCode } from "@prisma/client";
import { emailAdapter } from "@/lib/notify";

type Locale = "en" | "no" | "sv" | "da" | "fi" | "de";

export function localeForMarketCode(code: MarketCode): Locale {
  switch (code) {
    case "NO":
      return "no";
    case "SE":
      return "sv";
    case "DK":
      return "da";
    case "FI":
      return "fi";
    case "DE":
    case "AT":
    case "CH":
      return "de";
    case "UK":
    case "IE":
      return "en";
  }
}

type EmailArgs = {
  locale: Locale;
  contactName: string;
  titleName: string;
  publisherName: string;
  link: string;
  inviterName: string;
  ttlDays?: number;
};

type Built = { subject: string; text: string };

function en(a: EmailArgs): Built {
  return {
    subject: `Price check: ${a.titleName}`,
    text: [
      `Hi ${a.contactName},`,
      ``,
      `${a.inviterName} at NativeSpin is keeping our catalog pricing for ${a.titleName} (${a.publisherName}) up to date.`,
      ``,
      `Could you confirm your current native rates? It takes ~2 minutes:`,
      a.link,
      ``,
      `Or — just hit reply with your latest rates and what's included. We'll log it for you.`,
      ``,
      `Link is good for ${a.ttlDays ?? 30} days.`,
      ``,
      `Thanks,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

function no(a: EmailArgs): Built {
  return {
    subject: `Prisjekk: ${a.titleName}`,
    text: [
      `Hei ${a.contactName},`,
      ``,
      `${a.inviterName} fra NativeSpin holder katalogprisene for ${a.titleName} (${a.publisherName}) oppdatert.`,
      ``,
      `Kan du bekrefte gjeldende native-priser? Tar omtrent 2 minutter:`,
      a.link,
      ``,
      `Eller — svar på denne e-posten med priser og hva som inngår, så logger vi det for deg.`,
      ``,
      `Lenken er gyldig i ${a.ttlDays ?? 30} dager.`,
      ``,
      `Takk,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

function sv(a: EmailArgs): Built {
  return {
    subject: `Priskontroll: ${a.titleName}`,
    text: [
      `Hej ${a.contactName},`,
      ``,
      `${a.inviterName} på NativeSpin håller katalogpriserna för ${a.titleName} (${a.publisherName}) aktuella.`,
      ``,
      `Kan du bekräfta era nuvarande native-priser? Tar ungefär 2 minuter:`,
      a.link,
      ``,
      `Eller — svara på det här mejlet med priser och vad som ingår, så loggar vi det åt dig.`,
      ``,
      `Länken är giltig i ${a.ttlDays ?? 30} dagar.`,
      ``,
      `Tack,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

function da(a: EmailArgs): Built {
  return {
    subject: `Pristjek: ${a.titleName}`,
    text: [
      `Hej ${a.contactName},`,
      ``,
      `${a.inviterName} fra NativeSpin holder katalogpriserne for ${a.titleName} (${a.publisherName}) opdaterede.`,
      ``,
      `Kan du bekræfte jeres aktuelle native-priser? Det tager ca. 2 minutter:`,
      a.link,
      ``,
      `Eller — svar på denne mail med priser og hvad der er inkluderet, så logger vi det for dig.`,
      ``,
      `Linket gælder i ${a.ttlDays ?? 30} dage.`,
      ``,
      `Tak,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

function fi(a: EmailArgs): Built {
  return {
    subject: `Hintatarkistus: ${a.titleName}`,
    text: [
      `Hei ${a.contactName},`,
      ``,
      `${a.inviterName} NativeSpinlta pitää luettelohinnat ajan tasalla julkaisulle ${a.titleName} (${a.publisherName}).`,
      ``,
      `Voitko vahvistaa nykyiset natiivimainonnan hinnat? Vie noin 2 minuuttia:`,
      a.link,
      ``,
      `Tai — vastaa tähän viestiin nykyisillä hinnoilla ja sisällöllä, niin kirjaamme ne puolestasi.`,
      ``,
      `Linkki on voimassa ${a.ttlDays ?? 30} päivää.`,
      ``,
      `Kiitos,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

function de(a: EmailArgs): Built {
  return {
    subject: `Preisabfrage: ${a.titleName}`,
    text: [
      `Hallo ${a.contactName},`,
      ``,
      `${a.inviterName} bei NativeSpin hält die Katalogpreise für ${a.titleName} (${a.publisherName}) aktuell.`,
      ``,
      `Können Sie Ihre aktuellen Native-Preise bestätigen? Dauert etwa 2 Minuten:`,
      a.link,
      ``,
      `Oder — antworten Sie einfach auf diese E-Mail mit Preisen und Leistungsumfang. Wir tragen es für Sie ein.`,
      ``,
      `Der Link ist ${a.ttlDays ?? 30} Tage gültig.`,
      ``,
      `Danke,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

export function buildPriceRequestEmail(args: EmailArgs): Built {
  switch (args.locale) {
    case "no":
      return no(args);
    case "sv":
      return sv(args);
    case "da":
      return da(args);
    case "fi":
      return fi(args);
    case "de":
      return de(args);
    case "en":
    default:
      return en(args);
  }
}

export async function sendPriceRequestEmail(args: {
  to: string;
  replyTo?: string;
} & EmailArgs): Promise<void> {
  const built = buildPriceRequestEmail(args);
  await emailAdapter({
    to: args.to,
    subject: built.subject,
    text: built.text,
  });
}
```

- [ ] **Step 4: Run — verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/email.ts src/lib/pricing/email.test.ts
git commit -m "feat(pricing): localized outreach email per market code"
```

---

### Task 11: `src/lib/pricing/requests.ts` — request lifecycle (create, send, bulk, cancel)

**Files:**
- Create: `src/lib/pricing/requests.ts`
- Test: `src/lib/pricing/requests.test.ts`

- [ ] **Step 1: Write tests for pure helpers**

Create `src/lib/pricing/requests.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTitlesByPrimaryContact, requestStatus } from "./requests";

test("groupTitlesByPrimaryContact groups by contact, skips titles with none", () => {
  const titles = [
    { id: "t1", primaryContactId: "c1" },
    { id: "t2", primaryContactId: "c1" },
    { id: "t3", primaryContactId: "c2" },
    { id: "t4", primaryContactId: null },
  ];
  const result = groupTitlesByPrimaryContact(titles);
  assert.deepEqual(result.grouped.get("c1"), ["t1", "t2"]);
  assert.deepEqual(result.grouped.get("c2"), ["t3"]);
  assert.deepEqual(result.skipped, ["t4"]);
});

test("requestStatus distinguishes lifecycle states", () => {
  const now = new Date("2026-05-26");
  assert.equal(
    requestStatus(
      { sentAt: null, openedAt: null, respondedAt: null, cancelledAt: null, expiresAt: new Date("2027-01-01") },
      now,
    ),
    "draft",
  );
  assert.equal(
    requestStatus(
      { sentAt: new Date("2026-05-01"), openedAt: null, respondedAt: null, cancelledAt: null, expiresAt: new Date("2027-01-01") },
      now,
    ),
    "sent",
  );
  assert.equal(
    requestStatus(
      { sentAt: new Date("2026-05-01"), openedAt: new Date("2026-05-02"), respondedAt: null, cancelledAt: null, expiresAt: new Date("2027-01-01") },
      now,
    ),
    "opened",
  );
  assert.equal(
    requestStatus(
      { sentAt: new Date("2026-05-01"), openedAt: new Date("2026-05-02"), respondedAt: new Date("2026-05-05"), cancelledAt: null, expiresAt: new Date("2027-01-01") },
      now,
    ),
    "responded",
  );
  assert.equal(
    requestStatus(
      { sentAt: new Date("2026-05-01"), openedAt: null, respondedAt: null, cancelledAt: new Date("2026-05-02"), expiresAt: new Date("2027-01-01") },
      now,
    ),
    "cancelled",
  );
  assert.equal(
    requestStatus(
      { sentAt: new Date("2026-01-01"), openedAt: null, respondedAt: null, cancelledAt: null, expiresAt: new Date("2026-02-01") },
      now,
    ),
    "expired",
  );
});
```

- [ ] **Step 2: Run — verify FAIL**

- [ ] **Step 3: Implement**

Create `src/lib/pricing/requests.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  newPriceRequestToken,
  expiryFromNow,
  priceRequestLink,
} from "./tokens";
import {
  buildPriceRequestEmail,
  localeForMarketCode,
  sendPriceRequestEmail,
} from "./email";
import { listContactsForTitle, pickPrimaryContact } from "./contacts";

// ---------- Pure helpers ----------

export type RequestLifecycleShape = {
  sentAt: Date | null;
  openedAt: Date | null;
  respondedAt: Date | null;
  cancelledAt: Date | null;
  expiresAt: Date;
};

export type RequestStatus =
  | "draft"
  | "sent"
  | "opened"
  | "responded"
  | "cancelled"
  | "expired";

export function requestStatus(
  r: RequestLifecycleShape,
  now: Date = new Date(),
): RequestStatus {
  if (r.cancelledAt) return "cancelled";
  if (r.respondedAt) return "responded";
  if (!r.sentAt) return "draft";
  if (r.expiresAt.getTime() <= now.getTime()) return "expired";
  if (r.openedAt) return "opened";
  return "sent";
}

export function groupTitlesByPrimaryContact(
  titles: Array<{ id: string; primaryContactId: string | null }>,
): { grouped: Map<string, string[]>; skipped: string[] } {
  const grouped = new Map<string, string[]>();
  const skipped: string[] = [];
  for (const t of titles) {
    if (!t.primaryContactId) {
      skipped.push(t.id);
      continue;
    }
    const arr = grouped.get(t.primaryContactId) ?? [];
    arr.push(t.id);
    grouped.set(t.primaryContactId, arr);
  }
  return { grouped, skipped };
}

// ---------- DB-backed lifecycle ----------

export async function createPriceRequest(args: {
  titleId: string;
  salesContactId: string;
  requestedById: string;
  ttlDays?: number;
}) {
  const req = await prisma.priceRequest.create({
    data: {
      titleId: args.titleId,
      salesContactId: args.salesContactId,
      requestedById: args.requestedById,
      token: newPriceRequestToken(),
      expiresAt: expiryFromNow(args.ttlDays),
    },
  });
  await recordAudit(args.requestedById, "price_request.create", `PriceRequest:${req.id}`, {
    titleId: args.titleId,
    salesContactId: args.salesContactId,
  });
  return req;
}

export async function sendPriceRequest(args: {
  priceRequestId: string;
  actorId: string;
}) {
  const req = await prisma.priceRequest.findUnique({
    where: { id: args.priceRequestId },
    include: {
      title: { include: { publisher: true, market: true } },
      salesContact: true,
      requestedBy: { select: { name: true, email: true } },
    },
  });
  if (!req) throw new Error("price_request.not_found");
  if (req.cancelledAt) throw new Error("price_request.cancelled");
  if (req.respondedAt) throw new Error("price_request.already_responded");

  const locale = localeForMarketCode(req.title.market.code);
  const link = priceRequestLink(req.token, locale);
  await sendPriceRequestEmail({
    to: req.salesContact.email,
    replyTo: req.requestedBy.email ?? undefined,
    locale,
    contactName: req.salesContact.name,
    titleName: req.title.name,
    publisherName: req.title.publisher.name,
    link,
    inviterName: req.requestedBy.name ?? "The NativeSpin team",
  });

  await prisma.priceRequest.update({
    where: { id: req.id },
    data: { sentAt: new Date() },
  });
  await recordAudit(args.actorId, "price_request.send", `PriceRequest:${req.id}`, {
    to: req.salesContact.email,
  });
}

export async function createPriceRequestsBulk(args: {
  titleIds: string[];
  requestedById: string;
  send?: boolean;
  ttlDays?: number;
}): Promise<{
  created: Array<{ priceRequestId: string; titleId: string; salesContactId: string }>;
  skipped: Array<{ titleId: string; reason: "no_primary_contact" }>;
}> {
  const created: Array<{ priceRequestId: string; titleId: string; salesContactId: string }> = [];
  const skipped: Array<{ titleId: string; reason: "no_primary_contact" }> = [];

  for (const titleId of args.titleIds) {
    const contacts = await listContactsForTitle(titleId);
    const primary = pickPrimaryContact(
      contacts.map((c) => ({ id: c.id, isPrimary: c.isPrimary })),
    );
    if (!primary) {
      skipped.push({ titleId, reason: "no_primary_contact" });
      continue;
    }
    const req = await createPriceRequest({
      titleId,
      salesContactId: primary.id,
      requestedById: args.requestedById,
      ttlDays: args.ttlDays,
    });
    if (args.send) {
      await sendPriceRequest({ priceRequestId: req.id, actorId: args.requestedById });
    }
    created.push({ priceRequestId: req.id, titleId, salesContactId: primary.id });
  }

  return { created, skipped };
}

export async function markRequestOpened(token: string) {
  // Idempotent: only set openedAt if currently null.
  const req = await prisma.priceRequest.findUnique({ where: { token } });
  if (!req || req.openedAt) return;
  await prisma.priceRequest.update({
    where: { id: req.id },
    data: { openedAt: new Date() },
  });
}

export async function cancelPriceRequest(args: {
  priceRequestId: string;
  actorId: string;
}) {
  await prisma.priceRequest.update({
    where: { id: args.priceRequestId },
    data: { cancelledAt: new Date() },
  });
  await recordAudit(args.actorId, "price_request.cancel", `PriceRequest:${args.priceRequestId}`);
}

export async function resendPriceRequest(args: {
  priceRequestId: string;
  actorId: string;
}) {
  // Re-send fires the email again and bumps expiresAt forward so a
  // dormant link can be revived without creating a duplicate request.
  await prisma.priceRequest.update({
    where: { id: args.priceRequestId },
    data: { expiresAt: expiryFromNow() },
  });
  await sendPriceRequest({ priceRequestId: args.priceRequestId, actorId: args.actorId });
}

export async function findRequestByToken(token: string) {
  return prisma.priceRequest.findUnique({
    where: { token },
    include: {
      title: {
        include: {
          publisher: true,
          market: true,
          products: { where: { active: true }, include: { spec: true } },
        },
      },
      salesContact: true,
    },
  });
}
```

- [ ] **Step 4: Run — verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/requests.ts src/lib/pricing/requests.test.ts
git commit -m "feat(pricing): PriceRequest create, send, bulk, cancel, resend"
```

---

### Task 12: `src/lib/pricing/quotes.ts` — log, apply, reject

**Files:**
- Create: `src/lib/pricing/quotes.ts`
- Test: `src/lib/pricing/quotes.test.ts`

- [ ] **Step 1: Write tests for the validation helper**

Create `src/lib/pricing/quotes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateQuoteInput } from "./quotes";

test("validateQuoteInput accepts a complete existing-product quote", () => {
  const v = validateQuoteInput({
    productId: "p1",
    price: 1000,
    currency: "EUR",
  });
  assert.equal(v.ok, true);
});

test("validateQuoteInput accepts a draft quote", () => {
  const v = validateQuoteInput({
    draftProductType: "OTHER",
    draftProductName: "Newsletter",
    price: 500,
    currency: "NOK",
  });
  assert.equal(v.ok, true);
});

test("validateQuoteInput rejects both productId and draft", () => {
  const v = validateQuoteInput({
    productId: "p1",
    draftProductType: "OTHER",
    draftProductName: "Newsletter",
    price: 500,
    currency: "NOK",
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.reason, /both/);
});

test("validateQuoteInput rejects neither productId nor draft", () => {
  const v = validateQuoteInput({
    price: 500,
    currency: "NOK",
  });
  assert.equal(v.ok, false);
});

test("validateQuoteInput rejects non-positive price", () => {
  const v = validateQuoteInput({
    productId: "p1",
    price: 0,
    currency: "EUR",
  });
  assert.equal(v.ok, false);
});

test("validateQuoteInput rejects bad currency code", () => {
  const v = validateQuoteInput({
    productId: "p1",
    price: 100,
    currency: "EU",
  });
  assert.equal(v.ok, false);
});
```

- [ ] **Step 2: Run — verify FAIL**

- [ ] **Step 3: Implement**

Create `src/lib/pricing/quotes.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import type { ProductType, PriceResponseSource } from "@prisma/client";

// ---------- Pure validation ----------

export type QuoteInput = {
  productId?: string;
  draftProductType?: ProductType;
  draftProductName?: string;
  draftProductDesc?: string;
  price: number;
  currency: string;
  includedText?: string;
  excludedText?: string;
  validUntil?: Date;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateQuoteInput(q: QuoteInput): ValidationResult {
  const hasProduct = !!q.productId;
  const hasDraft = !!q.draftProductType && !!q.draftProductName;
  if (hasProduct && hasDraft) {
    return { ok: false, reason: "quote.both_product_and_draft" };
  }
  if (!hasProduct && !hasDraft) {
    return { ok: false, reason: "quote.neither_product_nor_draft" };
  }
  if (typeof q.price !== "number" || q.price <= 0) {
    return { ok: false, reason: "quote.invalid_price" };
  }
  if (!/^[A-Z]{3}$/.test(q.currency)) {
    return { ok: false, reason: "quote.invalid_currency" };
  }
  return { ok: true };
}

// ---------- DB-backed actions ----------

export async function logQuote(args: QuoteInput & {
  priceRequestId?: string;
  recordedById: string;
}) {
  const v = validateQuoteInput(args);
  if (!v.ok) throw new Error(v.reason);

  const quote = await prisma.priceQuote.create({
    data: {
      priceRequestId: args.priceRequestId ?? null,
      productId: args.productId ?? null,
      draftProductType: args.draftProductType ?? null,
      draftProductName: args.draftProductName ?? null,
      draftProductDesc: args.draftProductDesc ?? null,
      price: args.price.toString(),
      currency: args.currency,
      includedText: args.includedText ?? null,
      excludedText: args.excludedText ?? null,
      validUntil: args.validUntil ?? null,
      recordedById: args.recordedById,
    },
  });
  await recordAudit(args.recordedById, "price_quote.log", `PriceQuote:${quote.id}`, {
    productId: args.productId,
    price: args.price,
    currency: args.currency,
  });
  return quote;
}

export async function logFormSubmission(args: {
  priceRequestId: string;
  hasNative: boolean | null;
  responseNote?: string;
  quotes: QuoteInput[];
  recordedById: string; // typically the rep's contact id stand-in, or "anonymous"
}) {
  // Validate all quote lines first — fail fast before touching DB.
  for (const q of args.quotes) {
    const v = validateQuoteInput(q);
    if (!v.ok) throw new Error(v.reason);
  }

  return prisma.$transaction(async (tx) => {
    for (const q of args.quotes) {
      await tx.priceQuote.create({
        data: {
          priceRequestId: args.priceRequestId,
          productId: q.productId ?? null,
          draftProductType: q.draftProductType ?? null,
          draftProductName: q.draftProductName ?? null,
          draftProductDesc: q.draftProductDesc ?? null,
          price: q.price.toString(),
          currency: q.currency,
          includedText: q.includedText ?? null,
          excludedText: q.excludedText ?? null,
          validUntil: q.validUntil ?? null,
          recordedById: args.recordedById,
        },
      });
    }
    await tx.priceRequest.update({
      where: { id: args.priceRequestId },
      data: {
        respondedAt: new Date(),
        responseSource: "LINK_FORM" satisfies PriceResponseSource,
        responseNote: args.responseNote ?? null,
        hasNative: args.hasNative,
      },
    });
  });
}

export async function applyQuote(args: {
  quoteId: string;
  actorUserId: string;
}) {
  const quote = await prisma.priceQuote.findUnique({
    where: { id: args.quoteId },
    include: { priceRequest: { include: { title: true } } },
  });
  if (!quote) throw new Error("quote.not_found");
  if (quote.appliedAt) throw new Error("quote.already_applied");
  if (quote.rejectedAt) throw new Error("quote.rejected");

  await prisma.$transaction(async (tx) => {
    let productId = quote.productId;

    // Draft → create the Product first (inactive by default; admin
    // must activate via existing markTitleNative flow to expose it).
    if (!productId) {
      if (!quote.draftProductType || !quote.draftProductName) {
        throw new Error("quote.draft_missing_fields");
      }
      if (!quote.priceRequest) {
        throw new Error("quote.draft_requires_request");
      }
      const titleId = quote.priceRequest.titleId;
      const newProduct = await tx.product.create({
        data: {
          titleId,
          type: quote.draftProductType,
          name: quote.draftProductName,
          description: quote.draftProductDesc ?? null,
          currency: quote.currency,
          basePrice: quote.price,
          visibility: "INDICATIVE",
          active: false,
          bookable: false,
          confirmedAt: new Date(),
          confirmedSource: `PriceQuote:${quote.id}`,
        },
      });
      productId = newProduct.id;
      await tx.priceQuote.update({
        where: { id: quote.id },
        data: { productId },
      });
    } else {
      await tx.product.update({
        where: { id: productId },
        data: {
          basePrice: quote.price,
          currency: quote.currency,
          confirmedAt: new Date(),
          confirmedSource: `PriceQuote:${quote.id}`,
        },
      });
    }

    await tx.priceQuote.update({
      where: { id: quote.id },
      data: {
        appliedAt: new Date(),
        appliedById: args.actorUserId,
      },
    });
  });

  await recordAudit(args.actorUserId, "price_quote.apply", `PriceQuote:${args.quoteId}`, {
    productId: quote.productId,
  });
}

export async function rejectQuote(args: {
  quoteId: string;
  reason?: string;
  actorUserId: string;
}) {
  const quote = await prisma.priceQuote.findUnique({ where: { id: args.quoteId } });
  if (!quote) throw new Error("quote.not_found");
  if (quote.appliedAt) throw new Error("quote.already_applied");
  if (quote.rejectedAt) throw new Error("quote.already_rejected");

  await prisma.priceQuote.update({
    where: { id: args.quoteId },
    data: {
      rejectedAt: new Date(),
      rejectedById: args.actorUserId,
      rejectedReason: args.reason ?? null,
    },
  });
  await recordAudit(args.actorUserId, "price_quote.reject", `PriceQuote:${args.quoteId}`, {
    reason: args.reason,
  });
}

export async function editPendingQuote(args: {
  quoteId: string;
  price?: number;
  currency?: string;
  includedText?: string;
  excludedText?: string;
  validUntil?: Date | null;
  actorUserId: string;
}) {
  const quote = await prisma.priceQuote.findUnique({ where: { id: args.quoteId } });
  if (!quote) throw new Error("quote.not_found");
  if (quote.appliedAt) throw new Error("quote.already_applied");
  if (quote.rejectedAt) throw new Error("quote.rejected");

  if (args.price !== undefined && args.price <= 0) {
    throw new Error("quote.invalid_price");
  }
  if (args.currency !== undefined && !/^[A-Z]{3}$/.test(args.currency)) {
    throw new Error("quote.invalid_currency");
  }

  await prisma.priceQuote.update({
    where: { id: args.quoteId },
    data: {
      ...(args.price !== undefined ? { price: args.price.toString() } : {}),
      ...(args.currency !== undefined ? { currency: args.currency } : {}),
      ...(args.includedText !== undefined ? { includedText: args.includedText } : {}),
      ...(args.excludedText !== undefined ? { excludedText: args.excludedText } : {}),
      ...(args.validUntil !== undefined ? { validUntil: args.validUntil } : {}),
    },
  });
  await recordAudit(args.actorUserId, "price_quote.edit", `PriceQuote:${args.quoteId}`);
}

export async function listPendingQuotes(args?: {
  marketCode?: string;
  publisherId?: string;
  limit?: number;
}) {
  return prisma.priceQuote.findMany({
    where: {
      appliedAt: null,
      rejectedAt: null,
      ...(args?.publisherId
        ? {
            OR: [
              { product: { title: { publisherId: args.publisherId } } },
              { priceRequest: { title: { publisherId: args.publisherId } } },
            ],
          }
        : {}),
      ...(args?.marketCode
        ? {
            OR: [
              { product: { title: { market: { code: args.marketCode as never } } } },
              { priceRequest: { title: { market: { code: args.marketCode as never } } } },
            ],
          }
        : {}),
    },
    include: {
      product: { include: { title: true } },
      priceRequest: { include: { title: true, salesContact: true } },
    },
    orderBy: { recordedAt: "desc" },
    take: args?.limit ?? 50,
  });
}

export async function getPriceHistory(productId: string) {
  return prisma.priceQuote.findMany({
    where: { productId },
    include: { priceRequest: { include: { salesContact: true } } },
    orderBy: { recordedAt: "desc" },
  });
}
```

- [ ] **Step 4: Run — verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/quotes.ts src/lib/pricing/quotes.test.ts
git commit -m "feat(pricing): quote log, apply (with draft→Product), reject, edit"
```

---

## Phase 3 — Server actions

### Task 13: `src/app/price-actions.ts` — desk UI action wrappers

**Files:**
- Create: `src/app/price-actions.ts`

- [ ] **Step 1: Implement the action wrappers**

Create `src/app/price-actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  createSalesContact,
  attachContactToTitle,
  setPrimaryContact,
  detachContactFromTitle,
} from "@/lib/pricing/contacts";
import {
  createPriceRequest,
  createPriceRequestsBulk,
  sendPriceRequest,
  cancelPriceRequest,
  resendPriceRequest,
} from "@/lib/pricing/requests";
import {
  applyQuote,
  rejectQuote,
  editPendingQuote,
  logQuote,
} from "@/lib/pricing/quotes";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function optionalField(formData: FormData, key: string): string | undefined {
  const v = field(formData, key);
  return v.length ? v : undefined;
}

async function requireSuperadmin(locale: string): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") {
    redirect(`/${locale}/signin`);
  }
  return session.user.id;
}

// ---- Sales contacts ----

export async function createSalesContactAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  const contact = await createSalesContact({
    publisherId: field(formData, "publisherId"),
    name: field(formData, "name"),
    email: field(formData, "email"),
    phone: optionalField(formData, "phone"),
    role: optionalField(formData, "role"),
    notes: optionalField(formData, "notes"),
    actorId: userId,
  });
  if (titleId) {
    await attachContactToTitle({
      salesContactId: contact.id,
      titleId,
      isPrimary: formData.get("makePrimary") === "on",
      actorId: userId,
    });
  }
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

export async function attachContactAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  await attachContactToTitle({
    salesContactId: field(formData, "salesContactId"),
    titleId,
    isPrimary: formData.get("makePrimary") === "on",
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

export async function setPrimaryContactAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  await setPrimaryContact({
    salesContactId: field(formData, "salesContactId"),
    titleId,
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

export async function detachContactAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  await detachContactFromTitle({
    salesContactId: field(formData, "salesContactId"),
    titleId,
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

// ---- Price requests ----

export async function createAndSendRequestAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  const req = await createPriceRequest({
    titleId,
    salesContactId: field(formData, "salesContactId"),
    requestedById: userId,
  });
  await sendPriceRequest({ priceRequestId: req.id, actorId: userId });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

export async function createPriceRequestsBulkAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleIds = formData.getAll("titleIds").filter((v): v is string => typeof v === "string");
  await createPriceRequestsBulk({
    titleIds,
    requestedById: userId,
    send: true,
  });
  revalidatePath(`/${locale}/desk/titles`);
}

export async function cancelPriceRequestAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  await cancelPriceRequest({
    priceRequestId: field(formData, "priceRequestId"),
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${field(formData, "titleId")}`);
}

export async function resendPriceRequestAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  await resendPriceRequest({
    priceRequestId: field(formData, "priceRequestId"),
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${field(formData, "titleId")}`);
}

export async function logManualResponseAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  await logQuote({
    priceRequestId: optionalField(formData, "priceRequestId"),
    productId: field(formData, "productId"),
    price: Number(field(formData, "price")),
    currency: field(formData, "currency"),
    includedText: optionalField(formData, "includedText"),
    excludedText: optionalField(formData, "excludedText"),
    recordedById: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

// ---- Quotes ----

export async function applyQuoteAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  await applyQuote({
    quoteId: field(formData, "quoteId"),
    actorUserId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${field(formData, "titleId")}`);
  revalidatePath(`/${locale}/desk/price-quotes`);
}

export async function rejectQuoteAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  await rejectQuote({
    quoteId: field(formData, "quoteId"),
    reason: optionalField(formData, "reason"),
    actorUserId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${field(formData, "titleId")}`);
  revalidatePath(`/${locale}/desk/price-quotes`);
}

export async function editPendingQuoteAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const price = field(formData, "price");
  const currency = field(formData, "currency");
  await editPendingQuote({
    quoteId: field(formData, "quoteId"),
    price: price ? Number(price) : undefined,
    currency: currency || undefined,
    includedText: optionalField(formData, "includedText"),
    excludedText: optionalField(formData, "excludedText"),
    actorUserId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${field(formData, "titleId")}`);
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/price-actions.ts
git commit -m "feat(pricing): server actions for desk UI"
```

---

## Phase 4 — Desk UI

### Task 14: Add freshness column + filter chips to `/desk/titles`

**Files:**
- Modify: `src/app/[locale]/desk/titles/page.tsx`
- Modify: `src/messages/en.json` + other locales (add freshness strings)

- [ ] **Step 1: Read the existing page to confirm its current structure**

```bash
sed -n '1,100p' src/app/\[locale\]/desk/titles/page.tsx
```

- [ ] **Step 2: Add freshness column to the title query**

In `src/app/[locale]/desk/titles/page.tsx`, locate the `prisma.title.findMany` call and add `products: { select: { confirmedAt: true } }` to its `select` / `include`.

Then in the render, for each title compute:
```tsx
import { freshnessBucket, latestConfirmedAtAcrossProducts, ageInDays } from "@/lib/pricing/freshness";

const latest = latestConfirmedAtAcrossProducts(title.products);
const bucket = freshnessBucket(latest);
const ageDays = ageInDays(latest);
```

Add a column cell that renders the bucket as a colored badge:
```tsx
<td className="px-3 py-2">
  {bucket === "never" && <span className="badge badge-red">{t("freshness.never")}</span>}
  {bucket === "stale" && <span className="badge badge-red">{t("freshness.stale", { days: ageDays })}</span>}
  {bucket === "aging" && <span className="badge badge-yellow">{t("freshness.aging", { days: ageDays })}</span>}
  {bucket === "fresh" && <span className="badge badge-green">{t("freshness.fresh", { days: ageDays })}</span>}
</td>
```

- [ ] **Step 3: Add filter chips that read from `searchParams`**

In the same page, parse a `freshness` query param: `"never" | "stale" | "aging" | "fresh" | undefined`. Filter the result list in-memory after computing buckets. Render chips above the table:

```tsx
const activeFreshness = sp.freshness;
const chip = (value: string, label: string) => (
  <Link
    href={{ pathname: `/${locale}/desk/titles`, query: { ...sp, freshness: value === activeFreshness ? undefined : value } }}
    className={activeFreshness === value ? "chip chip-active" : "chip"}
  >
    {label}
  </Link>
);
```

Render the four chips: `Never`, `Stale (>90d)`, `Aging (31-90d)`, `Fresh (<=30d)`.

- [ ] **Step 4: Add the new translation keys**

In `src/messages/en.json` under the `titleAdmin` namespace, add:
```json
"freshness": {
  "column": "Price freshness",
  "never": "Never confirmed",
  "stale": "Stale ({days}d)",
  "aging": "Aging ({days}d)",
  "fresh": "Fresh ({days}d)"
}
```

Repeat for `no`, `sv`, `da`, `de`, `fi` with translations (use the patterns established in those files).

- [ ] **Step 5: Run typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/app/\[locale\]/desk/titles/page.tsx src/messages/
git commit -m "feat(desk): price-freshness column + filter chips on titles list"
```

---

### Task 15: Add bulk "Send price request" toolbar to `/desk/titles`

**Files:**
- Modify: `src/app/[locale]/desk/titles/page.tsx`
- Modify: `src/messages/*.json`

- [ ] **Step 1: Wrap the title list in a form posting to the bulk action**

In `src/app/[locale]/desk/titles/page.tsx`, change the table to render rows inside a `<form>` posting to `createPriceRequestsBulkAction`. Each row gets a checkbox:

```tsx
import { createPriceRequestsBulkAction } from "@/app/price-actions";

<form action={createPriceRequestsBulkAction}>
  <input type="hidden" name="locale" value={locale} />
  <div className="toolbar">
    <button type="submit" className="btn-primary">
      {t("bulk.sendPriceRequest")}
    </button>
    <span className="text-sm text-gray-500">{t("bulk.hint")}</span>
  </div>
  <table>
    {/* ... */}
    <tbody>
      {titles.map((title) => (
        <tr key={title.id}>
          <td><input type="checkbox" name="titleIds" value={title.id} /></td>
          {/* ... existing cells ... */}
        </tr>
      ))}
    </tbody>
  </table>
</form>
```

- [ ] **Step 2: Add translation strings**

In `src/messages/en.json` under `titleAdmin`:
```json
"bulk": {
  "sendPriceRequest": "Send price request to selected",
  "hint": "Skips titles with no primary sales contact"
}
```

Repeat for other locales.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/desk/titles/page.tsx src/messages/
git commit -m "feat(desk): bulk send price requests from titles list"
```

---

### Task 16: `SalesContactsPanel` component + mount on title detail page

**Files:**
- Create: `src/app/[locale]/desk/titles/[id]/_components/SalesContactsPanel.tsx`
- Modify: `src/app/[locale]/desk/titles/[id]/page.tsx`
- Modify: `src/messages/*.json`

- [ ] **Step 1: Build the panel component (Server Component)**

Create `src/app/[locale]/desk/titles/[id]/_components/SalesContactsPanel.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { listContactsForTitle, listContactsForPublisher } from "@/lib/pricing/contacts";
import {
  createSalesContactAction,
  attachContactAction,
  setPrimaryContactAction,
  detachContactAction,
} from "@/app/price-actions";

export async function SalesContactsPanel({
  locale,
  titleId,
  publisherId,
}: {
  locale: string;
  titleId: string;
  publisherId: string;
}) {
  const t = await getTranslations({ locale, namespace: "salesContacts" });
  const [attached, allForPublisher] = await Promise.all([
    listContactsForTitle(titleId),
    listContactsForPublisher(publisherId),
  ]);
  const attachedIds = new Set(attached.map((c) => c.id));
  const availableToAttach = allForPublisher.filter((c) => !attachedIds.has(c.id));

  return (
    <section className="panel">
      <h2 className="panel-title">{t("title")}</h2>

      {attached.length === 0 && <p className="empty">{t("empty")}</p>}

      <ul className="contact-list">
        {attached.map((c) => (
          <li key={c.id} className="contact-row">
            <div>
              <strong>{c.name}</strong>
              {c.isPrimary && <span className="badge badge-blue">{t("primary")}</span>}
              <div className="muted">{c.email}{c.phone ? ` · ${c.phone}` : ""}</div>
              {c.role && <div className="muted small">{c.role}</div>}
            </div>
            <div className="actions">
              {!c.isPrimary && (
                <form action={setPrimaryContactAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="titleId" value={titleId} />
                  <input type="hidden" name="salesContactId" value={c.id} />
                  <button type="submit">{t("makePrimary")}</button>
                </form>
              )}
              <form action={detachContactAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="titleId" value={titleId} />
                <input type="hidden" name="salesContactId" value={c.id} />
                <button type="submit" className="btn-danger">{t("detach")}</button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      {availableToAttach.length > 0 && (
        <details>
          <summary>{t("attachExisting")}</summary>
          <form action={attachContactAction} className="form-row">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="titleId" value={titleId} />
            <select name="salesContactId" required>
              {availableToAttach.map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
              ))}
            </select>
            <label><input type="checkbox" name="makePrimary" /> {t("makePrimary")}</label>
            <button type="submit">{t("attach")}</button>
          </form>
        </details>
      )}

      <details>
        <summary>{t("addNew")}</summary>
        <form action={createSalesContactAction} className="form-grid">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="titleId" value={titleId} />
          <input type="hidden" name="publisherId" value={publisherId} />
          <label>{t("name")} <input name="name" required /></label>
          <label>{t("email")} <input name="email" type="email" required /></label>
          <label>{t("phone")} <input name="phone" /></label>
          <label>{t("role")} <input name="role" /></label>
          <label>{t("notes")} <textarea name="notes" /></label>
          <label><input type="checkbox" name="makePrimary" /> {t("makePrimary")}</label>
          <button type="submit" className="btn-primary">{t("create")}</button>
        </form>
      </details>
    </section>
  );
}
```

- [ ] **Step 2: Mount on title detail page**

Edit `src/app/[locale]/desk/titles/[id]/page.tsx`. After the existing pricing editor section, add:

```tsx
import { SalesContactsPanel } from "./_components/SalesContactsPanel";

// ...inside the page render, after the existing pricing form...
<SalesContactsPanel
  locale={locale}
  titleId={title.id}
  publisherId={title.publisherId}
/>
```

- [ ] **Step 3: Add translation strings**

In `src/messages/en.json`, add a new top-level namespace `salesContacts`:

```json
"salesContacts": {
  "title": "Sales contacts",
  "empty": "No sales contacts attached to this title.",
  "primary": "Primary",
  "makePrimary": "Make primary",
  "detach": "Detach",
  "attachExisting": "Attach an existing contact",
  "attach": "Attach",
  "addNew": "Add new contact",
  "name": "Name",
  "email": "Email",
  "phone": "Phone",
  "role": "Role",
  "notes": "Notes",
  "create": "Create contact"
}
```

Repeat for `no`, `sv`, `da`, `de`, `fi`.

- [ ] **Step 4: typecheck + commit**

```bash
pnpm typecheck
git add src/app/\[locale\]/desk/titles/\[id\]/ src/messages/
git commit -m "feat(desk): SalesContactsPanel on title detail page"
```

---

### Task 17: `PriceRequestsPanel` component + mount on title detail

**Files:**
- Create: `src/app/[locale]/desk/titles/[id]/_components/PriceRequestsPanel.tsx`
- Modify: `src/app/[locale]/desk/titles/[id]/page.tsx`
- Modify: `src/messages/*.json`

- [ ] **Step 1: Build the panel**

Create `src/app/[locale]/desk/titles/[id]/_components/PriceRequestsPanel.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requestStatus } from "@/lib/pricing/requests";
import {
  createAndSendRequestAction,
  cancelPriceRequestAction,
  resendPriceRequestAction,
  logManualResponseAction,
} from "@/app/price-actions";
import { listContactsForTitle } from "@/lib/pricing/contacts";

export async function PriceRequestsPanel({
  locale,
  titleId,
}: {
  locale: string;
  titleId: string;
}) {
  const t = await getTranslations({ locale, namespace: "priceRequests" });
  const [requests, contacts] = await Promise.all([
    prisma.priceRequest.findMany({
      where: { titleId },
      include: { salesContact: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    listContactsForTitle(titleId),
  ]);

  return (
    <section className="panel">
      <h2 className="panel-title">{t("title")}</h2>

      <details open>
        <summary>{t("sendNew")}</summary>
        {contacts.length === 0 ? (
          <p className="empty">{t("noContactsHint")}</p>
        ) : (
          <form action={createAndSendRequestAction} className="form-row">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="titleId" value={titleId} />
            <select name="salesContactId" required>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.isPrimary ? ` (${t("primary")})` : ""} — {c.email}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-primary">{t("send")}</button>
          </form>
        )}
      </details>

      {requests.length === 0 ? (
        <p className="empty">{t("noRequests")}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t("col.contact")}</th>
              <th>{t("col.created")}</th>
              <th>{t("col.status")}</th>
              <th>{t("col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              const status = requestStatus(r);
              return (
                <tr key={r.id}>
                  <td>{r.salesContact.name} <span className="muted small">{r.salesContact.email}</span></td>
                  <td>{r.createdAt.toISOString().slice(0, 10)}</td>
                  <td><span className={`badge status-${status}`}>{t(`status.${status}`)}</span></td>
                  <td className="actions">
                    {(status === "draft" || status === "sent" || status === "opened" || status === "expired") && (
                      <>
                        <form action={resendPriceRequestAction}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="titleId" value={titleId} />
                          <input type="hidden" name="priceRequestId" value={r.id} />
                          <button type="submit">{t("resend")}</button>
                        </form>
                        <form action={cancelPriceRequestAction}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="titleId" value={titleId} />
                          <input type="hidden" name="priceRequestId" value={r.id} />
                          <button type="submit" className="btn-danger">{t("cancel")}</button>
                        </form>
                      </>
                    )}
                    {(status === "sent" || status === "opened" || status === "expired") && (
                      <details>
                        <summary>{t("logManual")}</summary>
                        <ManualLogForm
                          locale={locale}
                          titleId={titleId}
                          priceRequestId={r.id}
                        />
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

async function ManualLogForm({
  locale,
  titleId,
  priceRequestId,
}: {
  locale: string;
  titleId: string;
  priceRequestId: string;
}) {
  const t = await getTranslations({ locale, namespace: "priceRequests" });
  const products = await prisma.product.findMany({
    where: { titleId, active: true },
    select: { id: true, name: true, type: true, currency: true },
  });
  return (
    <form action={logManualResponseAction} className="form-grid">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="titleId" value={titleId} />
      <input type="hidden" name="priceRequestId" value={priceRequestId} />
      <label>{t("manual.product")}
        <select name="productId" required>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
          ))}
        </select>
      </label>
      <label>{t("manual.price")} <input name="price" type="number" step="0.01" required /></label>
      <label>{t("manual.currency")} <input name="currency" defaultValue={products[0]?.currency ?? "EUR"} maxLength={3} required /></label>
      <label>{t("manual.included")} <textarea name="includedText" /></label>
      <label>{t("manual.excluded")} <textarea name="excludedText" /></label>
      <button type="submit" className="btn-primary">{t("manual.submit")}</button>
    </form>
  );
}
```

- [ ] **Step 2: Mount on title detail page**

In `src/app/[locale]/desk/titles/[id]/page.tsx`, after `SalesContactsPanel`:

```tsx
import { PriceRequestsPanel } from "./_components/PriceRequestsPanel";

<PriceRequestsPanel locale={locale} titleId={title.id} />
```

- [ ] **Step 3: Add translation strings**

In `src/messages/en.json`:

```json
"priceRequests": {
  "title": "Price requests",
  "sendNew": "Send a new request",
  "noContactsHint": "Add a sales contact above before sending a request.",
  "noRequests": "No requests yet for this title.",
  "send": "Send request",
  "resend": "Resend",
  "cancel": "Cancel",
  "logManual": "Log response manually",
  "primary": "primary",
  "col": { "contact": "Contact", "created": "Created", "status": "Status", "actions": "Actions" },
  "status": {
    "draft": "Draft",
    "sent": "Sent",
    "opened": "Opened",
    "responded": "Responded",
    "cancelled": "Cancelled",
    "expired": "Expired"
  },
  "manual": {
    "product": "Product",
    "price": "Price",
    "currency": "Currency",
    "included": "What's included",
    "excluded": "What's NOT included",
    "submit": "Log this quote"
  }
}
```

Repeat for other locales.

- [ ] **Step 4: typecheck + commit**

```bash
pnpm typecheck
git add src/app/\[locale\]/desk/titles/\[id\]/ src/messages/
git commit -m "feat(desk): PriceRequestsPanel with send + resend + manual-log"
```

---

### Task 18: `PendingQuotesPanel` + global `/desk/price-quotes` page

**Files:**
- Create: `src/app/[locale]/desk/titles/[id]/_components/PendingQuotesPanel.tsx`
- Create: `src/app/[locale]/desk/price-quotes/page.tsx`
- Modify: `src/app/[locale]/desk/titles/[id]/page.tsx`
- Modify: `src/messages/*.json`

- [ ] **Step 1: Build the panel component**

Create `src/app/[locale]/desk/titles/[id]/_components/PendingQuotesPanel.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import {
  applyQuoteAction,
  rejectQuoteAction,
  editPendingQuoteAction,
} from "@/app/price-actions";

export async function PendingQuotesPanel({
  locale,
  titleId,
}: {
  locale: string;
  titleId: string;
}) {
  const t = await getTranslations({ locale, namespace: "pendingQuotes" });

  const quotes = await prisma.priceQuote.findMany({
    where: {
      appliedAt: null,
      rejectedAt: null,
      OR: [
        { product: { titleId } },
        { priceRequest: { titleId } },
      ],
    },
    include: {
      product: true,
      priceRequest: { include: { salesContact: true } },
    },
    orderBy: { recordedAt: "desc" },
  });

  if (quotes.length === 0) {
    return (
      <section className="panel">
        <h2 className="panel-title">{t("title")}</h2>
        <p className="empty">{t("empty")}</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2 className="panel-title">{t("title")}</h2>
      <ul className="quote-list">
        {quotes.map((q) => (
          <li key={q.id} className="quote-card">
            <div className="cols">
              <div>
                <h3>{t("currentLive")}</h3>
                {q.product ? (
                  <>
                    <div className="big-price">
                      {q.product.basePrice.toString()} {q.product.currency}
                    </div>
                    <div className="muted">
                      {q.product.confirmedAt
                        ? t("confirmedAt", { date: q.product.confirmedAt.toISOString().slice(0, 10) })
                        : t("neverConfirmed")}
                    </div>
                  </>
                ) : (
                  <div className="muted">{t("draftProduct")}</div>
                )}
              </div>
              <div>
                <h3>{t("incomingQuote")}</h3>
                <div className="big-price">{q.price.toString()} {q.currency}</div>
                <div className="muted">
                  {t("receivedAt", { date: q.recordedAt.toISOString().slice(0, 10) })}
                  {q.priceRequest?.salesContact && (
                    <> · {q.priceRequest.salesContact.name}</>
                  )}
                </div>
                {q.includedText && (
                  <div><strong>{t("included")}:</strong> {q.includedText}</div>
                )}
                {q.excludedText && (
                  <div><strong>{t("excluded")}:</strong> {q.excludedText}</div>
                )}
                {q.draftProductName && (
                  <div><strong>{t("newFormat")}:</strong> {q.draftProductName} ({q.draftProductType})</div>
                )}
              </div>
            </div>
            <div className="actions">
              <form action={applyQuoteAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="titleId" value={titleId} />
                <input type="hidden" name="quoteId" value={q.id} />
                <button type="submit" className="btn-primary">{t("apply")}</button>
              </form>
              <form action={rejectQuoteAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="titleId" value={titleId} />
                <input type="hidden" name="quoteId" value={q.id} />
                <input name="reason" placeholder={t("rejectReason")} />
                <button type="submit" className="btn-danger">{t("reject")}</button>
              </form>
              <details>
                <summary>{t("editBefore")}</summary>
                <form action={editPendingQuoteAction} className="form-row">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="titleId" value={titleId} />
                  <input type="hidden" name="quoteId" value={q.id} />
                  <label>{t("price")} <input name="price" type="number" step="0.01" defaultValue={q.price.toString()} /></label>
                  <label>{t("currency")} <input name="currency" defaultValue={q.currency} maxLength={3} /></label>
                  <button type="submit">{t("saveEdit")}</button>
                </form>
              </details>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Build the global `/desk/price-quotes` page**

Create `src/app/[locale]/desk/price-quotes/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listPendingQuotes } from "@/lib/pricing/quotes";
import {
  applyQuoteAction,
  rejectQuoteAction,
} from "@/app/price-actions";
import { Link } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export default async function DeskPriceQuotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") {
    redirect(`/${locale}/desk`);
  }
  const t = await getTranslations({ locale, namespace: "pendingQuotes" });

  const quotes = await listPendingQuotes({
    marketCode: typeof sp.market === "string" ? sp.market : undefined,
    publisherId: typeof sp.publisher === "string" ? sp.publisher : undefined,
    limit: 100,
  });

  return (
    <main className="container">
      <h1>{t("queueTitle")}</h1>
      {quotes.length === 0 ? (
        <p className="empty">{t("queueEmpty")}</p>
      ) : (
        <ul className="quote-list">
          {quotes.map((q) => {
            const titleId = q.product?.titleId ?? q.priceRequest?.titleId ?? "";
            const titleName = q.product?.title?.name ?? q.priceRequest?.title?.name ?? "—";
            return (
              <li key={q.id} className="quote-card">
                <div className="header">
                  <Link href={`/desk/titles/${titleId}`}>{titleName}</Link>
                  <span className="muted">{q.recordedAt.toISOString().slice(0, 10)}</span>
                </div>
                <div>{q.price.toString()} {q.currency}</div>
                <div className="actions">
                  <form action={applyQuoteAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="titleId" value={titleId} />
                    <input type="hidden" name="quoteId" value={q.id} />
                    <button type="submit" className="btn-primary">{t("apply")}</button>
                  </form>
                  <form action={rejectQuoteAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="titleId" value={titleId} />
                    <input type="hidden" name="quoteId" value={q.id} />
                    <button type="submit" className="btn-danger">{t("reject")}</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Mount the panel on title detail page**

Edit `src/app/[locale]/desk/titles/[id]/page.tsx`:

```tsx
import { PendingQuotesPanel } from "./_components/PendingQuotesPanel";

<PendingQuotesPanel locale={locale} titleId={title.id} />
```

- [ ] **Step 4: Add translations**

In `src/messages/en.json`:

```json
"pendingQuotes": {
  "title": "Pending quotes",
  "empty": "No quotes awaiting your review for this title.",
  "queueTitle": "Pending quotes — all titles",
  "queueEmpty": "Nothing pending. Inbox zero.",
  "currentLive": "Current live price",
  "incomingQuote": "Incoming quote",
  "confirmedAt": "Confirmed {date}",
  "neverConfirmed": "Never confirmed",
  "draftProduct": "New format (no live product yet)",
  "receivedAt": "Received {date}",
  "included": "Included",
  "excluded": "Excluded",
  "newFormat": "New format",
  "apply": "Apply",
  "reject": "Reject",
  "rejectReason": "Reason (optional)",
  "editBefore": "Edit before applying",
  "price": "Price",
  "currency": "Currency",
  "saveEdit": "Save"
}
```

Repeat for other locales.

- [ ] **Step 5: typecheck + commit**

```bash
pnpm typecheck
git add src/app/\[locale\]/desk/ src/messages/
git commit -m "feat(desk): PendingQuotesPanel + global pending-quotes queue page"
```

---

## Phase 5 — Magic-link form

### Task 19: Public `/[locale]/price-request/[token]` form

**Files:**
- Create: `src/app/[locale]/price-request/[token]/page.tsx`
- Create: `src/app/[locale]/price-request/[token]/actions.ts`
- Create: `src/app/[locale]/price-request/[token]/thanks/page.tsx`
- Modify: `src/messages/*.json`

- [ ] **Step 1: Build the form page**

Create `src/app/[locale]/price-request/[token]/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { findRequestByToken, markRequestOpened } from "@/lib/pricing/requests";
import { checkRequest } from "@/lib/pricing/tokens";
import { submitPriceRequestAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PriceRequestFormPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: "priceRequestForm" });

  const req = await findRequestByToken(token);
  if (!req) notFound();

  const verdict = checkRequest({
    expiresAt: req.expiresAt,
    respondedAt: req.respondedAt,
    cancelledAt: req.cancelledAt,
  });

  if (!verdict?.ok) {
    return (
      <main className="container narrow">
        <h1>{t(`closed.${verdict?.reason ?? "unknown"}.title`)}</h1>
        <p>{t(`closed.${verdict?.reason ?? "unknown"}.body`)}</p>
      </main>
    );
  }

  // Idempotent open-tracking
  await markRequestOpened(token);

  return (
    <main className="container narrow">
      <header>
        <h1>{t("hi", { name: req.salesContact.name })}</h1>
        <p>{t("intro", { title: req.title.name, publisher: req.title.publisher.name })}</p>
      </header>

      <form action={submitPriceRequestAction} className="form-stack">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="locale" value={locale} />

        <fieldset>
          <legend>{t("hasNative.question")}</legend>
          <label><input type="radio" name="hasNative" value="yes" defaultChecked /> {t("hasNative.yes")}</label>
          <label><input type="radio" name="hasNative" value="no" /> {t("hasNative.no")}</label>
          <label><input type="radio" name="hasNative" value="unknown" /> {t("hasNative.unknown")}</label>
        </fieldset>

        <fieldset>
          <legend>{t("products.legend")}</legend>
          {req.title.products.length === 0 && (
            <p className="muted">{t("products.none")}</p>
          )}
          {req.title.products.map((p, idx) => (
            <div key={p.id} className="product-card">
              <h3>{p.name} <span className="muted">({p.type})</span></h3>
              <input type="hidden" name={`products[${idx}].productId`} value={p.id} />
              <label><input type="checkbox" name={`products[${idx}].skip`} /> {t("products.skip")}</label>
              <label>{t("products.price")} <input name={`products[${idx}].price`} type="number" step="0.01" /></label>
              <label>{t("products.currency")} <input name={`products[${idx}].currency`} defaultValue={p.currency} maxLength={3} /></label>
              <label>{t("products.included")} <textarea name={`products[${idx}].included`} placeholder={t("products.includedPlaceholder")} /></label>
              <label>{t("products.excluded")} <textarea name={`products[${idx}].excluded`} placeholder={t("products.excludedPlaceholder")} /></label>
              <label>{t("products.validUntil")} <input name={`products[${idx}].validUntil`} type="date" /></label>
            </div>
          ))}
        </fieldset>

        <fieldset>
          <legend>{t("draft.legend")}</legend>
          <p className="muted small">{t("draft.hint")}</p>
          {[0, 1, 2].map((i) => (
            <details key={i}>
              <summary>{t("draft.addFormat", { n: i + 1 })}</summary>
              <div className="product-card">
                <label>{t("draft.type")}
                  <select name={`drafts[${i}].type`}>
                    <option value="">—</option>
                    <option value="NATIVE_ARTICLE">Native article</option>
                    <option value="ADVERTORIAL">Advertorial</option>
                    <option value="NATIVE_DISPLAY">Native display</option>
                    <option value="CONTEXTUAL">Contextual</option>
                    <option value="PACKAGE">Package</option>
                    <option value="OTHER">Other</option>
                  </select>
                </label>
                <label>{t("draft.name")} <input name={`drafts[${i}].name`} /></label>
                <label>{t("draft.desc")} <textarea name={`drafts[${i}].desc`} /></label>
                <label>{t("draft.price")} <input name={`drafts[${i}].price`} type="number" step="0.01" /></label>
                <label>{t("draft.currency")} <input name={`drafts[${i}].currency`} defaultValue={req.title.market.currency} maxLength={3} /></label>
                <label>{t("products.included")} <textarea name={`drafts[${i}].included`} /></label>
                <label>{t("products.excluded")} <textarea name={`drafts[${i}].excluded`} /></label>
              </div>
            </details>
          ))}
        </fieldset>

        <label>{t("note")} <textarea name="responseNote" rows={3} /></label>

        <button type="submit" className="btn-primary">{t("submit")}</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Build the submit action**

Create `src/app/[locale]/price-request/[token]/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import type { ProductType } from "@prisma/client";
import { findRequestByToken } from "@/lib/pricing/requests";
import { logFormSubmission, type QuoteInput } from "@/lib/pricing/quotes";
import { checkRequest } from "@/lib/pricing/tokens";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function submitPriceRequestAction(formData: FormData) {
  const token = str(formData, "token");
  const locale = str(formData, "locale") || "en";

  const req = await findRequestByToken(token);
  if (!req) redirect(`/${locale}/price-request/${token}`);

  const verdict = checkRequest({
    expiresAt: req.expiresAt,
    respondedAt: req.respondedAt,
    cancelledAt: req.cancelledAt,
  });
  if (!verdict?.ok) redirect(`/${locale}/price-request/${token}`);

  const hasNativeRaw = str(formData, "hasNative");
  const hasNative =
    hasNativeRaw === "yes" ? true : hasNativeRaw === "no" ? false : null;

  const quotes: QuoteInput[] = [];

  // Existing products
  for (let i = 0; i < req.title.products.length; i++) {
    const skipRaw = formData.get(`products[${i}].skip`);
    if (skipRaw === "on") continue;
    const productId = str(formData, `products[${i}].productId`);
    const priceRaw = str(formData, `products[${i}].price`);
    if (!productId || !priceRaw) continue;
    const validRaw = str(formData, `products[${i}].validUntil`);
    quotes.push({
      productId,
      price: Number(priceRaw),
      currency: str(formData, `products[${i}].currency`).toUpperCase() || "EUR",
      includedText: str(formData, `products[${i}].included`) || undefined,
      excludedText: str(formData, `products[${i}].excluded`) || undefined,
      validUntil: validRaw ? new Date(validRaw) : undefined,
    });
  }

  // Draft formats
  for (let i = 0; i < 3; i++) {
    const typeRaw = str(formData, `drafts[${i}].type`) as ProductType | "";
    const nameRaw = str(formData, `drafts[${i}].name`);
    const priceRaw = str(formData, `drafts[${i}].price`);
    if (!typeRaw || !nameRaw || !priceRaw) continue;
    quotes.push({
      draftProductType: typeRaw,
      draftProductName: nameRaw,
      draftProductDesc: str(formData, `drafts[${i}].desc`) || undefined,
      price: Number(priceRaw),
      currency: str(formData, `drafts[${i}].currency`).toUpperCase() || "EUR",
      includedText: str(formData, `drafts[${i}].included`) || undefined,
      excludedText: str(formData, `drafts[${i}].excluded`) || undefined,
    });
  }

  if (quotes.length === 0 && hasNative !== false) {
    // No data submitted but they didn't say "no native" — re-render the form.
    redirect(`/${locale}/price-request/${token}`);
  }

  await logFormSubmission({
    priceRequestId: req.id,
    hasNative,
    responseNote: str(formData, "responseNote") || undefined,
    quotes,
    recordedById: req.salesContactId,
  });

  redirect(`/${locale}/price-request/${token}/thanks`);
}
```

- [ ] **Step 3: Build the thanks page**

Create `src/app/[locale]/price-request/[token]/thanks/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";

export default async function ThanksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "priceRequestForm" });
  return (
    <main className="container narrow">
      <h1>{t("thanks.title")}</h1>
      <p>{t("thanks.body")}</p>
    </main>
  );
}
```

- [ ] **Step 4: Add translation strings**

In `src/messages/en.json`:

```json
"priceRequestForm": {
  "hi": "Hi {name},",
  "intro": "We list {title} ({publisher}) in our NativeSpin catalog and want to confirm current pricing.",
  "hasNative": {
    "question": "Does this title still offer native content?",
    "yes": "Yes",
    "no": "No",
    "unknown": "Not sure"
  },
  "products": {
    "legend": "Pricing per format",
    "none": "We don't have any products listed yet for this title.",
    "skip": "Skip — don't quote this one",
    "price": "Price",
    "currency": "Currency",
    "included": "What's included",
    "includedPlaceholder": "e.g. 1 sponsored article, 2-week homepage promotion, social distribution",
    "excluded": "What's NOT included",
    "excludedPlaceholder": "e.g. print, programmatic display, video production",
    "validUntil": "Valid until"
  },
  "draft": {
    "legend": "Other formats you'd like to add",
    "hint": "Add up to three more formats you'd like us to list.",
    "addFormat": "Add format {n}",
    "type": "Format type",
    "name": "Format name",
    "desc": "Short description",
    "price": "Price",
    "currency": "Currency"
  },
  "note": "Anything else we should know?",
  "submit": "Send pricing",
  "closed": {
    "expired": { "title": "Link expired", "body": "Please reach out to your contact at NativeSpin to issue a new link." },
    "responded": { "title": "Already received", "body": "Thanks — we already have your response on file." },
    "cancelled": { "title": "Link cancelled", "body": "Please reach out to your contact at NativeSpin." },
    "unknown": { "title": "Link not available", "body": "Please reach out to your contact at NativeSpin." }
  },
  "thanks": {
    "title": "Thanks!",
    "body": "We've logged your pricing. The NativeSpin desk will review and apply it shortly."
  }
}
```

Repeat for other locales.

- [ ] **Step 5: Ensure the route is publicly accessible (not gated by middleware)**

Check `src/middleware.ts`. If it blocks unauthenticated routes, add `/price-request/[token]` to the public allowlist:

```ts
// In the public-path matcher list:
"/(.*?)/price-request/.*",
```

(Use the exact pattern style the existing middleware uses.)

- [ ] **Step 6: typecheck + commit**

```bash
pnpm typecheck
git add src/app/\[locale\]/price-request/ src/messages/ src/middleware.ts
git commit -m "feat(pricing): public magic-link form for sales reps"
```

---

## Phase 6 — Buyer-facing rendering

### Task 20: Wire `isProductPriceShown` into catalog surfaces

**Files:**
- Modify: `src/app/[locale]/catalog/page.tsx`
- Modify: `src/app/[locale]/catalog/[slug]/page.tsx`
- Modify: `src/app/[locale]/catalog/compare/page.tsx`
- Modify: `src/app/api/v1/catalog/titles/[id]/route.ts`
- Modify: `src/app/api/v1/catalog/titles/route.ts`

- [ ] **Step 1: Update each catalog file to include `confirmedAt` in the Product select/include**

For every Prisma query that loads products for buyer-facing rendering, add `confirmedAt: true` to the select (and `active: true` if not already selected). Example for `src/app/[locale]/catalog/[slug]/page.tsx`:

Find the `prisma.title.findUnique` (or similar) call. In the `include` / `select` for `products`, add `confirmedAt: true, active: true`.

Repeat for each of the modified files.

- [ ] **Step 2: Update the public-API redact call**

Find every call to `redactProductPricing(...)` in the modified files. The new signature takes `(product, title)` instead of `(product, boolean)`. Update each call:

```ts
// before
const out = redactProductPricing(p, arePricesVisible(title));
// after
const out = redactProductPricing(p, title);
```

(The `pricing-visibility.ts` re-export keeps the import path valid.)

- [ ] **Step 3: Update render logic — show "Contact for price" when `priceVisible: false`**

Where a price is currently rendered conditionally on `arePricesVisible(title)`, switch to:

```tsx
import { isProductPriceShown } from "@/lib/pricing/visibility";

{isProductPriceShown(product, title)
  ? <PriceDisplay value={product.basePrice} currency={product.currency} />
  : <span className="contact-cta">{t("contactForPrice")}</span>}
```

When the price is hidden and `product.description` exists, render the description above the CTA. Fall back to `title.audienceNote` if description is empty.

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/catalog/ src/app/api/v1/catalog/
git commit -m "feat(catalog): hide unconfirmed prices behind 'Contact for price'"
```

---

### Task 21: Rename "Request price" → "Contact for price" in all locales

**Files:**
- Modify: `src/messages/{en,no,sv,da,de,fi}.json`
- Modify: `src/messages/landing/{en,no,sv,da,de,fi}/catalog.json`

- [ ] **Step 1: Grep for current uses**

```bash
grep -rn "Request price\|requestPrice\|contactForPrice" src/messages/
```

- [ ] **Step 2: Update each message file**

Replace any `"Request price"` (and equivalents) with the locale-appropriate "Contact for price":

| Locale | String |
|--------|--------|
| en | Contact for price |
| no | Kontakt for pris |
| sv | Kontakta för pris |
| da | Kontakt for pris |
| fi | Kysy hintaa |
| de | Preis auf Anfrage |

Also add a `contactForPrice` key under the existing catalog namespace in each `src/messages/<locale>.json` if no equivalent key exists, and reference it from the render in Task 20.

- [ ] **Step 3: Run typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/messages/
git commit -m "i18n: rename 'Request price' to 'Contact for price' across 6 locales"
```

---

### Task 22: Block self-serve FIRM checkout when `confirmedAt` is null

**Files:**
- Modify: file(s) where FIRM checkout currently checks `arePricesVisible`

- [ ] **Step 1: Find the checkout-gate site**

```bash
grep -rn "arePricesVisible\|allPricesVisible\|FIRM" src/app/ | grep -i "checkout\|submit\|request\|order"
```

- [ ] **Step 2: For each checkout-related file, extend the gate**

Wherever `arePricesVisible(title)` is currently the FIRM-checkout gate, replace with:

```ts
import { isProductPriceShown } from "@/lib/pricing/visibility";

const canFirmCheckout = products.every((p) => isProductPriceShown(p, p.title));
```

If the existing logic checks `allPricesVisible(titles)`, replace with a product-level all-shown check.

- [ ] **Step 3: typecheck**

- [ ] **Step 4: Commit**

```bash
git add src/app/
git commit -m "feat(checkout): block FIRM self-serve when price unconfirmed"
```

---

## Phase 7 — MCP server

### Task 23: Install MCP SDK + extend ApiKey scopes

**Files:**
- Modify: `package.json` (via pnpm)
- Create: `src/lib/mcp/auth.ts`
- Test: `src/lib/mcp/auth.test.ts`

- [ ] **Step 1: Install MCP SDK**

```bash
pnpm add @modelcontextprotocol/sdk
```

Verify it appears in `package.json` dependencies.

- [ ] **Step 2: Write tests for scope parsing**

Create `src/lib/mcp/auth.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasScope, parseScopes } from "./auth";

test("parseScopes splits comma list and trims", () => {
  assert.deepEqual(parseScopes("catalog:read, pricing:admin "), [
    "catalog:read",
    "pricing:admin",
  ]);
});

test("hasScope is exact-match", () => {
  assert.equal(hasScope("catalog:read,pricing:admin", "pricing:admin"), true);
  assert.equal(hasScope("catalog:read", "pricing:admin"), false);
  assert.equal(hasScope("", "pricing:admin"), false);
});
```

- [ ] **Step 3: Implement**

Create `src/lib/mcp/auth.ts`:

```ts
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type ApiKeyScope = "catalog:read" | "pricing:admin";

export function parseScopes(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function hasScope(raw: string, scope: ApiKeyScope): boolean {
  return parseScopes(raw).includes(scope);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticateApiKey(
  rawToken: string,
): Promise<{ id: string; scopes: string } | null> {
  if (!rawToken) return null;
  const key = await prisma.apiKey.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!key) return null;
  if (key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return null;
  // Best-effort last-used bump
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { id: key.id, scopes: key.scopes };
}

export function actorForApiKey(keyId: string): string {
  return `apikey:${keyId}`;
}
```

- [ ] **Step 4: Run tests — pass**

```bash
pnpm test -- src/lib/mcp/auth.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/mcp/
git commit -m "feat(mcp): add SDK + ApiKey scope helpers (pricing:admin)"
```

---

### Task 24: MCP read tools

**Files:**
- Create: `src/lib/mcp/tools-read.ts`

- [ ] **Step 1: Implement read tools**

Create `src/lib/mcp/tools-read.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { titlesNeedingCheck } from "@/lib/pricing/freshness";
import {
  listContactsForTitle,
  listContactsForPublisher,
} from "@/lib/pricing/contacts";
import { listPendingQuotes, getPriceHistory } from "@/lib/pricing/quotes";
import { requestStatus } from "@/lib/pricing/requests";
import type { MarketCode } from "@prisma/client";

// NOTE: we use zod for parameter validation. If zod isn't already a
// dep, install via `pnpm add zod` first.

export const readToolDefinitions = {
  native_list_titles_needing_price_check: {
    description:
      "List titles whose latest confirmed price is older than N days (or never confirmed). Use to find candidates for a price-check outreach.",
    parameters: z.object({
      market: z.enum(["NO", "SE", "DK", "FI", "DE", "AT", "CH", "UK", "IE"]).optional(),
      publisherId: z.string().optional(),
      olderThanDays: z.number().int().min(0).default(90),
    }),
    handler: async (args: {
      market?: MarketCode;
      publisherId?: string;
      olderThanDays: number;
    }) => {
      return titlesNeedingCheck({
        marketCode: args.market,
        publisherId: args.publisherId,
        olderThanDays: args.olderThanDays,
      });
    },
  },

  native_get_title: {
    description:
      "Get full title details including products (with confirmedAt), latest 10 quotes, and attached sales contacts.",
    parameters: z.object({
      idOrSlug: z.string(),
    }),
    handler: async (args: { idOrSlug: string }) => {
      const title = await prisma.title.findFirst({
        where: { OR: [{ id: args.idOrSlug }, { slug: args.idOrSlug }] },
        include: {
          publisher: true,
          market: true,
          products: { orderBy: { name: "asc" } },
        },
      });
      if (!title) return null;
      const [contacts, recentQuotes] = await Promise.all([
        listContactsForTitle(title.id),
        prisma.priceQuote.findMany({
          where: {
            OR: [
              { product: { titleId: title.id } },
              { priceRequest: { titleId: title.id } },
            ],
          },
          orderBy: { recordedAt: "desc" },
          take: 10,
        }),
      ]);
      return { ...title, contacts, recentQuotes };
    },
  },

  native_list_sales_contacts: {
    description: "List sales contacts, filtered by publisher or title.",
    parameters: z.object({
      publisherId: z.string().optional(),
      titleId: z.string().optional(),
    }),
    handler: async (args: { publisherId?: string; titleId?: string }) => {
      if (args.titleId) return listContactsForTitle(args.titleId);
      if (args.publisherId) return listContactsForPublisher(args.publisherId);
      return prisma.salesContact.findMany({ orderBy: { name: "asc" }, take: 200 });
    },
  },

  native_list_open_price_requests: {
    description:
      "List price requests that have been sent but not yet responded to or cancelled.",
    parameters: z.object({
      market: z.enum(["NO", "SE", "DK", "FI", "DE", "AT", "CH", "UK", "IE"]).optional(),
      olderThanDays: z.number().int().min(0).optional(),
    }),
    handler: async (args: { market?: MarketCode; olderThanDays?: number }) => {
      const cutoff = args.olderThanDays
        ? new Date(Date.now() - args.olderThanDays * 86400000)
        : undefined;
      const requests = await prisma.priceRequest.findMany({
        where: {
          sentAt: { not: null },
          respondedAt: null,
          cancelledAt: null,
          expiresAt: { gt: new Date() },
          ...(cutoff ? { sentAt: { lte: cutoff } } : {}),
          ...(args.market ? { title: { market: { code: args.market } } } : {}),
        },
        include: {
          title: { include: { market: true, publisher: true } },
          salesContact: true,
        },
        orderBy: { sentAt: "asc" },
        take: 200,
      });
      return requests.map((r) => ({
        id: r.id,
        title: r.title.name,
        market: r.title.market.code,
        publisher: r.title.publisher.name,
        contact: { name: r.salesContact.name, email: r.salesContact.email },
        sentAt: r.sentAt,
        openedAt: r.openedAt,
        expiresAt: r.expiresAt,
        status: requestStatus(r),
      }));
    },
  },

  native_list_pending_quotes: {
    description: "List PriceQuotes that have been received but not yet applied or rejected.",
    parameters: z.object({
      market: z.string().optional(),
      publisherId: z.string().optional(),
    }),
    handler: async (args: { market?: string; publisherId?: string }) =>
      listPendingQuotes(args),
  },

  native_get_price_history: {
    description: "Full PriceQuote history for a given product, newest first.",
    parameters: z.object({ productId: z.string() }),
    handler: async (args: { productId: string }) => getPriceHistory(args.productId),
  },
} as const;
```

- [ ] **Step 2: Install zod if not already present**

```bash
pnpm add zod
```

Confirm in package.json.

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/mcp/tools-read.ts
git commit -m "feat(mcp): read tool definitions (titles, contacts, requests, quotes)"
```

---

### Task 25: MCP mutation tools

**Files:**
- Create: `src/lib/mcp/tools-mutate.ts`

- [ ] **Step 1: Implement mutation tools**

Create `src/lib/mcp/tools-mutate.ts`:

```ts
import { z } from "zod";
import {
  createSalesContact,
  attachContactToTitle,
} from "@/lib/pricing/contacts";
import {
  createPriceRequest,
  createPriceRequestsBulk,
  sendPriceRequest,
  cancelPriceRequest,
} from "@/lib/pricing/requests";
import { applyQuote, logQuote } from "@/lib/pricing/quotes";
import type { ProductType } from "@prisma/client";

const productTypeSchema = z.enum([
  "NATIVE_ARTICLE",
  "ADVERTORIAL",
  "NATIVE_DISPLAY",
  "PACKAGE",
  "CONTEXTUAL",
  "OTHER",
]);

export const mutateToolDefinitions = (actorId: string) => ({
  native_create_sales_contact: {
    description: "Create a SalesContact under a publisher.",
    parameters: z.object({
      publisherId: z.string(),
      name: z.string(),
      email: z.string().email(),
      phone: z.string().optional(),
      role: z.string().optional(),
      notes: z.string().optional(),
    }),
    handler: async (a: {
      publisherId: string;
      name: string;
      email: string;
      phone?: string;
      role?: string;
      notes?: string;
    }) => createSalesContact({ ...a, actorId }),
  },

  native_attach_sales_contact: {
    description: "Attach an existing SalesContact to a title; optionally mark primary.",
    parameters: z.object({
      salesContactId: z.string(),
      titleId: z.string(),
      isPrimary: z.boolean().optional(),
    }),
    handler: async (a: {
      salesContactId: string;
      titleId: string;
      isPrimary?: boolean;
    }) => attachContactToTitle({ ...a, actorId }),
  },

  native_create_price_request: {
    description:
      "Create a PriceRequest for a single title. Set send=true to fire the outreach email immediately.",
    parameters: z.object({
      titleId: z.string(),
      salesContactId: z.string(),
      send: z.boolean().optional(),
    }),
    handler: async (a: {
      titleId: string;
      salesContactId: string;
      send?: boolean;
    }) => {
      const req = await createPriceRequest({
        titleId: a.titleId,
        salesContactId: a.salesContactId,
        requestedById: actorId,
      });
      if (a.send) {
        await sendPriceRequest({ priceRequestId: req.id, actorId });
      }
      return req;
    },
  },

  native_create_price_request_bulk: {
    description:
      "Create PriceRequests for many titles in one shot. Auto-picks each title's primary SalesContact. Returns the list of created requests plus any titles skipped because they have no primary contact.",
    parameters: z.object({
      titleIds: z.array(z.string()).min(1),
      send: z.boolean().optional(),
    }),
    handler: async (a: { titleIds: string[]; send?: boolean }) =>
      createPriceRequestsBulk({
        titleIds: a.titleIds,
        requestedById: actorId,
        send: a.send,
      }),
  },

  native_log_quote: {
    description:
      "Log a PriceQuote against an existing Product. Use for transcribing email/phone responses.",
    parameters: z.object({
      priceRequestId: z.string().optional(),
      productId: z.string(),
      price: z.number().positive(),
      currency: z.string().length(3),
      includedText: z.string().optional(),
      excludedText: z.string().optional(),
      validUntil: z.string().datetime().optional(),
    }),
    handler: async (a: {
      priceRequestId?: string;
      productId: string;
      price: number;
      currency: string;
      includedText?: string;
      excludedText?: string;
      validUntil?: string;
    }) =>
      logQuote({
        priceRequestId: a.priceRequestId,
        productId: a.productId,
        price: a.price,
        currency: a.currency,
        includedText: a.includedText,
        excludedText: a.excludedText,
        validUntil: a.validUntil ? new Date(a.validUntil) : undefined,
        recordedById: actorId,
      }),
  },

  native_log_quote_draft: {
    description:
      "Log a PriceQuote for a new format that doesn't have an existing Product yet. When applied, will create a new (inactive) Product.",
    parameters: z.object({
      priceRequestId: z.string().optional(),
      draftProductType: productTypeSchema,
      draftProductName: z.string(),
      draftProductDesc: z.string().optional(),
      price: z.number().positive(),
      currency: z.string().length(3),
      includedText: z.string().optional(),
      excludedText: z.string().optional(),
    }),
    handler: async (a: {
      priceRequestId?: string;
      draftProductType: ProductType;
      draftProductName: string;
      draftProductDesc?: string;
      price: number;
      currency: string;
      includedText?: string;
      excludedText?: string;
    }) =>
      logQuote({
        priceRequestId: a.priceRequestId,
        draftProductType: a.draftProductType,
        draftProductName: a.draftProductName,
        draftProductDesc: a.draftProductDesc,
        price: a.price,
        currency: a.currency,
        includedText: a.includedText,
        excludedText: a.excludedText,
        recordedById: actorId,
      }),
  },

  native_apply_quote: {
    description:
      "Apply a pending PriceQuote — commits its price to Product.basePrice + confirmedAt. For draft quotes, creates a new inactive Product first.",
    parameters: z.object({ quoteId: z.string() }),
    handler: async (a: { quoteId: string }) =>
      applyQuote({ quoteId: a.quoteId, actorUserId: actorId }),
  },

  native_cancel_price_request: {
    description: "Cancel an open PriceRequest.",
    parameters: z.object({ priceRequestId: z.string() }),
    handler: async (a: { priceRequestId: string }) =>
      cancelPriceRequest({ priceRequestId: a.priceRequestId, actorId }),
  },
} as const);
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/mcp/tools-mutate.ts
git commit -m "feat(mcp): mutation tool definitions (contacts, requests, quotes)"
```

---

### Task 26: MCP HTTP route + server wiring

**Files:**
- Create: `src/lib/mcp/server.ts`
- Create: `src/app/api/mcp/route.ts`

- [ ] **Step 1: Build the MCP server factory**

Create `src/lib/mcp/server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authenticateApiKey, hasScope, actorForApiKey } from "./auth";
import { readToolDefinitions } from "./tools-read";
import { mutateToolDefinitions } from "./tools-mutate";

export async function buildMcpServerForToken(rawToken: string): Promise<McpServer | null> {
  const key = await authenticateApiKey(rawToken);
  if (!key) return null;

  const server = new McpServer({
    name: "nativespin-pricing",
    version: "1.0.0",
  });

  const canRead =
    hasScope(key.scopes, "catalog:read") || hasScope(key.scopes, "pricing:admin");
  const canMutate = hasScope(key.scopes, "pricing:admin");
  if (!canRead) return null;

  // Read tools
  for (const [name, def] of Object.entries(readToolDefinitions)) {
    server.tool(name, def.description, def.parameters.shape, async (args) => {
      const parsed = def.parameters.parse(args);
      const result = await def.handler(parsed as never);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });
  }

  // Mutation tools (only if scope present)
  if (canMutate) {
    const mutators = mutateToolDefinitions(actorForApiKey(key.id));
    for (const [name, def] of Object.entries(mutators)) {
      server.tool(name, def.description, def.parameters.shape, async (args) => {
        const parsed = def.parameters.parse(args);
        const result = await def.handler(parsed as never);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      });
    }
  }

  return server;
}
```

- [ ] **Step 2: Build the HTTP route**

Create `src/app/api/mcp/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServerForToken } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractToken(req: NextRequest): string {
  return (
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  );
}

async function handle(req: NextRequest): Promise<Response> {
  const token = extractToken(req);
  const server = await buildMcpServerForToken(token);
  if (!server) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: every request creates fresh transport
  });
  await server.connect(transport);
  // The transport reads the request body and writes streaming SSE/JSON back.
  // Adapter shim: collect body, hand to transport, return its response.
  const body = req.method === "POST" ? await req.json() : null;
  const out = await transport.handleRequest(
    {
      method: req.method,
      headers: Object.fromEntries(req.headers.entries()),
      body,
    } as never,
    {} as never,
  );
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

If the StreamableHTTPServerTransport adapter shape differs from this sketch (the SDK API may differ slightly between versions), consult `node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts` and adjust the request/response adapter. The core contract is: pass the parsed JSON-RPC body in, get a JSON-RPC response out.

- [ ] **Step 4: Smoke test the MCP server locally**

In one terminal:
```bash
pnpm dev
```

In another:
```bash
# Issue an API key with pricing:admin scope via the existing /desk/api-keys UI
# (or insert directly: see scripts/seed-rate-cards-from-reach.ts for a similar pattern)
# Then:
claude mcp add native-local --transport http http://localhost:3000/api/mcp --header "X-API-Key: <token>"
claude mcp list
# Should show "native-local" connected
```

Run a read tool through Claude Code:
```
"Using native-local, list titles needing a price check older than 60 days"
```

Expected: returns JSON of titles.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/server.ts src/app/api/mcp/route.ts
git commit -m "feat(mcp): /api/mcp HTTP route + scope-gated tool exposure"
```

---

## Phase 8 — Polish

### Task 27: Admin dashboard banner for unconfirmed-products count

**Files:**
- Modify: `src/app/[locale]/desk/page.tsx`
- Modify: `src/messages/*.json`

- [ ] **Step 1: Add the banner**

In `src/app/[locale]/desk/page.tsx`, add at the top of the render:

```tsx
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";

const unconfirmedCount = await prisma.product.count({
  where: { active: true, confirmedAt: null },
});

{unconfirmedCount > 0 && (
  <aside className="banner banner-warn">
    {t("banner.unconfirmed", { count: unconfirmedCount })}{" "}
    <Link href={`/desk/titles?freshness=never`}>{t("banner.review")}</Link>
  </aside>
)}
```

- [ ] **Step 2: Add translation strings**

In `src/messages/en.json` under the desk namespace:

```json
"banner": {
  "unconfirmed": "{count, plural, one {1 product needs price confirmation} other {# products need price confirmation}}",
  "review": "Review them →"
}
```

Repeat for other locales.

- [ ] **Step 3: typecheck + commit**

```bash
pnpm typecheck
git add src/app/\[locale\]/desk/page.tsx src/messages/
git commit -m "feat(desk): banner highlighting unconfirmed-products count"
```

---

### Task 28: End-to-end smoke test (manual checklist)

This is a manual verification task — no automated test. Run after all other tasks have landed.

- [ ] **Step 1: Fresh DB reset + seed**

```bash
pnpm prisma migrate reset
pnpm db:seed
```

Expected: clean DB with seeded titles. All `Product.confirmedAt = null`.

- [ ] **Step 2: Verify buyer surfaces show "Contact for price"**

Visit `/en/catalog` and a few title detail pages. Every product should render the "Contact for price" CTA. The buyer description (`Product.description` or `Title.audienceNote`) should still show.

- [ ] **Step 3: Add a sales contact via desk UI**

Sign in as SUPERADMIN. Navigate to `/en/desk/titles/<some-id>`. Add a sales contact (use your own email). Mark them primary.

- [ ] **Step 4: Send a price request**

In the same title page, open the PriceRequests panel. Pick the contact, click Send. Check the email log (`console.log("[email]", ...)` from `notify.ts`) for the outbound message.

- [ ] **Step 5: Submit the magic-link form**

Copy the link from the email log. Open in an incognito window. Fill in the form: pick a price for one product, leave a note. Submit.

- [ ] **Step 6: Apply the quote**

Back in the desk title page, refresh. The PendingQuotes panel should show one entry with side-by-side comparison. Click Apply.

- [ ] **Step 7: Verify the buyer surface flipped**

Visit the title's `/en/catalog/[slug]` page. The product that was applied should now show its price (not "Contact for price").

- [ ] **Step 8: Test MCP path**

Create an API key with `pricing:admin` scope. Add the MCP server in Claude Code. Run:
- `native_list_titles_needing_price_check` (should return titles with no confirmed price)
- `native_create_price_request_bulk` for 2 titles
- `native_list_pending_quotes` (after responding via the magic-link)
- `native_apply_quote` on a returned quoteId

Each tool should return JSON with the expected shape.

- [ ] **Step 9: Commit a brief note documenting the verification**

Create `docs/superpowers/specs/2026-05-26-title-pricing-tracking-verification.md` (one-paragraph note: "Verified end-to-end on YYYY-MM-DD using ..."). Commit.

---

## Self-review notes

- **Spec coverage:** Section 1 (data model) → Tasks 1–5. Section 2 (lib) → Tasks 6–12. Section 3 (server actions) → Task 13. Section 4 (desk UI) → Tasks 14–18. Section 5 (magic-link) → Task 19. Section 6 (buyer-facing) → Tasks 20–22. Section 7 (MCP) → Tasks 23–26. Section 8 (email) folded into Task 10. Section 9 (testing) is colocated unit tests in each lib task + Task 28 manual E2E. Section 11 risk #1 (migration banner) → Task 27.
- **Placeholder check:** No TBD/TODO/placeholder text. Every step has exact code or exact commands.
- **Type consistency:** `applyQuote` signature is `{ quoteId, actorUserId }` everywhere (lib, action, MCP). `createPriceRequest` uses `requestedById` consistently. `recordedById` on PriceQuote is consistent. `actorId` for SalesContact actions and `actorUserId` for quote actions — both are user-id strings.
- **Test runner:** All test files use `node:test` + `node:assert/strict` to match the existing `tsx --test` setup. No Vitest, no Jest, no Playwright (none installed).
- **MCP SDK:** Plan installs `@modelcontextprotocol/sdk` and `zod` in Task 23 and 24 respectively. If the StreamableHTTPServerTransport API shape differs from the sketch in Task 26, the step instructs to consult the SDK types and adjust — the contract is well-defined (JSON-RPC in / JSON-RPC out).
