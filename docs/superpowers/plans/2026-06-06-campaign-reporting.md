# Campaign Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect end-of-campaign performance numbers from each publisher, tie them to the campaign window, and surface them to the desk and (as a deliverable) the advertiser.

**Architecture:** One Order = one campaign. A new `MetricsRequest` (mirroring `RateCardRequest`) with a `MetricsRequestBooking` join collects numbers per (order, publisher) via a tokenized self-serve form, AI-parsed email replies, and desk override — all landing in per-booking `BookingMetrics`. A daily `tsx`+cron scan creates/sends requests after the flight end; numbers are frozen at close for a reproducible advertiser report.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, `node:test` via `tsx --test`, next-intl, the existing outreach engine (`src/lib/outreach/*`).

**Spec:** `docs/superpowers/specs/2026-06-06-campaign-reporting-design.md`

**Conventions in this repo (read before starting):**
- Tests: `node:test` + `node:assert/strict`, co-located `*.test.ts`, run with `pnpm test` (`tsx --test "src/**/*.test.ts"`). DB-touching tests use the `*.it.test.ts` suffix (see `src/lib/content-fee.it.test.ts`).
- Migrations are **hand-written idempotent SQL** in `prisma/migrations/<UTC-timestamp>_<name>/migration.sql` (`ADD COLUMN IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object`). `prisma migrate dev` is blocked locally; the schema is applied via `prisma migrate deploy` on deploy. After editing `schema.prisma` always run `pnpm prisma:generate`.
- Named exports, `const`, functional components, early returns. Source-language strings in `en.json` first.
- Never run a dev server on port 3000.

---

## File structure

**Schema / migration**
- Modify: `prisma/schema.prisma` (enums, `Order`, `PublisherBooking`, `BookingMetrics`, new `MetricsRequest` + `MetricsRequestBooking`)
- Create: `prisma/migrations/20260607120000_campaign_reporting/migration.sql`

**Pure logic (unit-tested seams)**
- Create: `src/lib/campaign-reporting/tokens.ts` (+ `.test.ts`) — token gen/expiry/verdict/link
- Create: `src/lib/campaign-reporting/status.ts` (+ `.test.ts`) — request status, scan eligibility, booking grouping, recipient resolution
- Create: `src/lib/campaign-reporting/metrics-write.ts` (+ `.test.ts`) — source precedence, freeze snapshot
- Modify: `src/lib/reporting.ts` (+ `reporting.test.ts`) — `ctrPct`

**Orchestration (DB)**
- Create: `src/lib/campaign-reporting/campaign.ts` — `buildMetricsCampaign`, `sendMetricsRequestStep`, `selectMetricsBatchForSend`, `findMetricsRequestByToken`, `freezeDueCampaigns`, `ingestMetricsReply`, `writeBookingMetric`
- Create: `src/lib/campaign-reporting/email.ts` — `buildMetricsEmail`
- Modify: `src/lib/commerce/firm-order.ts:204` — set `publisherId`/`titleId` on booking create

**Scripts**
- Create: `scripts/build-metrics-campaign.ts`, `scripts/send-metrics-batch.ts`, `scripts/freeze-metrics-campaigns.ts`
- Modify: `package.json` scripts

**Self-serve form**
- Create: `src/app/[locale]/campaign-report/[token]/page.tsx`, `.../actions.ts`, `.../_components/MetricsForm.tsx`, `.../thanks/page.tsx`

**Desk surface**
- Modify: `src/app/[locale]/desk/orders/[orderId]/page.tsx` (query + Campaign section)
- Create: `src/app/[locale]/desk/orders/[orderId]/campaign-section.tsx`
- Modify: `src/app/desk-actions.ts` (new server actions)
- Create: `src/app/[locale]/desk/metrics-needs-contact/page.tsx` (NEEDS_CONTACT queue)

**Advertiser report**
- Modify: `src/app/[locale]/orders/[orderId]/page.tsx` (Campaign report section)
- Create: `src/app/api/export/campaign-report/[orderId].csv/route.ts`

**i18n**
- Modify: `src/messages/en.json` then `no/da/sv/fi/de.json`

---

## Phase 1 — Data model

### Task 1: Schema changes + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260607120000_campaign_reporting/migration.sql`

- [ ] **Step 1: Edit enums in `prisma/schema.prisma`**

Replace `enum MetricsSource`:

```prisma
enum MetricsSource {
  PUBLISHER_FORM  // tokenized self-serve form (publisher typed it)
  PUBLISHER_EMAIL // AI-transcribed from a publisher email reply (authoritative; raw snippet in note)
  DESK            // manual entry / override (wins on a mis-parse)
}

enum MetricsRequestStatus {
  NEEDS_CONTACT // no resolvable contact — surfaced to desk, not sent
  PENDING
  PARTIAL
  COMPLETE
  EXPIRED
  CANCELLED
}
```

- [ ] **Step 2: Add flight dates to `Order`**

In `model Order`, after `nextEngagementNote`:

```prisma
  // Actual paid-media flight window (defaulted from the Plan on creation).
  // Drives the advertiser report window and the end-of-campaign scan.
  // Publisher article run (PublisherBooking.liveEndDate) may extend past this.
  flightStartDate    DateTime?
  flightEndDate      DateTime?
```

And add to the relations block: `metricsRequests MetricsRequest[]`.

- [ ] **Step 3: Extend `PublisherBooking`**

```prisma
model PublisherBooking {
  id          String        @id @default(cuid())
  orderLineId String        @unique
  orderLine   OrderLine     @relation(fields: [orderLineId], references: [id])
  // Denormalized at booking creation (backfilled in migration via the
  // product chain) so the campaign report + MetricsRequest group by
  // publisher without a nullable Product join. Mirrors Title.countryCode.
  publisherId String?
  publisher   Publisher?    @relation(fields: [publisherId], references: [id])
  titleId     String?
  title       Title?        @relation(fields: [titleId], references: [id])
  status      BookingStatus @default(PENDING)
  placementDate DateTime?
  // Actual article run (may extend past Order.flightEndDate).
  liveStartDate DateTime?
  liveEndDate   DateTime?
  liveUrl     String?
  // Publisher's own tracking link, when they provide one.
  publisherTrackingUrl String?
  confirmedAt DateTime?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  metrics            BookingMetrics?
  metricsRequestRefs MetricsRequestBooking[]

  @@index([publisherId])
  @@index([titleId])
}
```

Add the back-relations on `Publisher` (`bookings PublisherBooking[]`) and `Title` (`bookings PublisherBooking[]`).

- [ ] **Step 4: Extend `BookingMetrics`**

```prisma
model BookingMetrics {
  id          String           @id @default(cuid())
  bookingId   String           @unique
  booking     PublisherBooking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  // Latest reported values ("live-to-date").
  impressions Int?
  pageViews   Int?
  publisherReportedClicks Int? // publisher's own click count; distinct from first-party TrackedLink clicks
  avgTimeSec  Int?
  scrollDepthPct Int?
  extra       Json?            // only not-yet-promoted extras; never anything the report renders
  windowStart DateTime?
  windowEnd   DateTime?
  // Frozen campaign snapshot (the advertiser deliverable). Set at close; immutable after.
  frozenAt    DateTime?
  impressionsAtClose      Int?
  clicksFirstPartyAtClose Int?
  source      MetricsSource    @default(PUBLISHER_FORM)
  note        String?          // for the email path: the raw quoted snippet the number came from
  reportedAt  DateTime?
  reportedBy  String?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
}
```

- [ ] **Step 5: Add `MetricsRequest` + `MetricsRequestBooking`** (place near `RateCardRequest`)

```prisma
// One row = one (order, publisher) = one campaign-report thread = one token.
// Collects end-of-campaign numbers for that publisher's bookings in the order.
model MetricsRequest {
  id             String               @id @default(cuid())
  orderId        String
  order          Order                @relation(fields: [orderId], references: [id])
  publisherId    String
  publisher      Publisher            @relation(fields: [publisherId], references: [id])
  recipientEmail String?              // frozen at creation; null while NEEDS_CONTACT
  recipientName  String?
  locale         String               @default("en")
  token          String               @unique
  status         MetricsRequestStatus @default(PENDING)
  sentCount      Int                  @default(0)
  lastStepAt     DateTime?
  nextStepAt     DateTime?
  sentAt         DateTime?
  openedAt       DateTime?
  respondedAt    DateTime?
  cancelledAt    DateTime?
  expiresAt      DateTime
  createdById    String
  createdBy      User                 @relation("MetricsRequestCreator", fields: [createdById], references: [id])
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  bookings MetricsRequestBooking[]

  @@unique([orderId, publisherId])
  @@index([orderId])
  @@index([nextStepAt, respondedAt, cancelledAt])
  @@index([status])
}

model MetricsRequestBooking {
  metricsRequestId String
  metricsRequest   MetricsRequest   @relation(fields: [metricsRequestId], references: [id], onDelete: Cascade)
  bookingId        String
  booking          PublisherBooking @relation(fields: [bookingId], references: [id], onDelete: Cascade)

  @@id([metricsRequestId, bookingId])
  @@index([bookingId])
}
```

Add to `model User` relations: `metricsRequests MetricsRequest[] @relation("MetricsRequestCreator")`.
Add to `model Publisher` relations: `metricsRequests MetricsRequest[]`.

- [ ] **Step 6: Write the migration SQL**

Create `prisma/migrations/20260607120000_campaign_reporting/migration.sql`:

```sql
-- Campaign reporting: flight window, per-booking publisher anchor + live dates,
-- richer BookingMetrics, MetricsRequest + join.

-- Enums ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "MetricsRequestStatus" AS ENUM
    ('NEEDS_CONTACT','PENDING','PARTIAL','COMPLETE','EXPIRED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- MetricsSource: add the new members, migrate old PUBLISHER -> PUBLISHER_FORM.
ALTER TYPE "MetricsSource" ADD VALUE IF NOT EXISTS 'PUBLISHER_FORM';
ALTER TYPE "MetricsSource" ADD VALUE IF NOT EXISTS 'PUBLISHER_EMAIL';
-- (DESK already exists; PUBLISHER stays as a now-unused legacy value — Postgres
--  cannot drop an enum value. Existing rows are migrated below.)

-- Order ---------------------------------------------------------------------
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "flightStartDate" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "flightEndDate"   TIMESTAMP(3);

-- Backfill flight window from the linked Plan where present.
UPDATE "Order" o SET "flightStartDate" = p."startDate", "flightEndDate" = p."endDate"
FROM "Quote" q JOIN "Request" r ON r.id = q."requestId" JOIN "Plan" p ON p.id = r."planId"
WHERE q.id = o."quoteId" AND o."flightEndDate" IS NULL;

-- PublisherBooking ----------------------------------------------------------
ALTER TABLE "PublisherBooking" ADD COLUMN IF NOT EXISTS "publisherId" TEXT;
ALTER TABLE "PublisherBooking" ADD COLUMN IF NOT EXISTS "titleId" TEXT;
ALTER TABLE "PublisherBooking" ADD COLUMN IF NOT EXISTS "liveStartDate" TIMESTAMP(3);
ALTER TABLE "PublisherBooking" ADD COLUMN IF NOT EXISTS "liveEndDate" TIMESTAMP(3);
ALTER TABLE "PublisherBooking" ADD COLUMN IF NOT EXISTS "publisherTrackingUrl" TEXT;

-- Backfill publisherId/titleId via orderLine -> product -> title -> publisher.
UPDATE "PublisherBooking" b
SET "titleId" = t.id, "publisherId" = t."publisherId"
FROM "OrderLine" ol JOIN "Product" pr ON pr.id = ol."productId" JOIN "Title" t ON t.id = pr."titleId"
WHERE ol.id = b."orderLineId" AND b."publisherId" IS NULL;

DO $$ BEGIN
  ALTER TABLE "PublisherBooking" ADD CONSTRAINT "PublisherBooking_publisherId_fkey"
    FOREIGN KEY ("publisherId") REFERENCES "Publisher"(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "PublisherBooking" ADD CONSTRAINT "PublisherBooking_titleId_fkey"
    FOREIGN KEY ("titleId") REFERENCES "Title"(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "PublisherBooking_publisherId_idx" ON "PublisherBooking"("publisherId");
CREATE INDEX IF NOT EXISTS "PublisherBooking_titleId_idx" ON "PublisherBooking"("titleId");

-- BookingMetrics ------------------------------------------------------------
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "pageViews" INTEGER;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "publisherReportedClicks" INTEGER;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "avgTimeSec" INTEGER;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "scrollDepthPct" INTEGER;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "extra" JSONB;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "windowStart" TIMESTAMP(3);
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "windowEnd" TIMESTAMP(3);
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "frozenAt" TIMESTAMP(3);
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "impressionsAtClose" INTEGER;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "clicksFirstPartyAtClose" INTEGER;
UPDATE "BookingMetrics" SET "source" = 'PUBLISHER_FORM' WHERE "source" = 'PUBLISHER';

-- MetricsRequest + join -----------------------------------------------------
CREATE TABLE IF NOT EXISTS "MetricsRequest" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "publisherId" TEXT NOT NULL,
  "recipientEmail" TEXT,
  "recipientName" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "token" TEXT NOT NULL,
  "status" "MetricsRequestStatus" NOT NULL DEFAULT 'PENDING',
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "lastStepAt" TIMESTAMP(3),
  "nextStepAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetricsRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MetricsRequest_token_key" ON "MetricsRequest"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "MetricsRequest_orderId_publisherId_key" ON "MetricsRequest"("orderId","publisherId");
CREATE INDEX IF NOT EXISTS "MetricsRequest_orderId_idx" ON "MetricsRequest"("orderId");
CREATE INDEX IF NOT EXISTS "MetricsRequest_nextStepAt_respondedAt_cancelledAt_idx" ON "MetricsRequest"("nextStepAt","respondedAt","cancelledAt");
CREATE INDEX IF NOT EXISTS "MetricsRequest_status_idx" ON "MetricsRequest"("status");
DO $$ BEGIN
  ALTER TABLE "MetricsRequest" ADD CONSTRAINT "MetricsRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "MetricsRequest" ADD CONSTRAINT "MetricsRequest_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "MetricsRequest" ADD CONSTRAINT "MetricsRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "MetricsRequestBooking" (
  "metricsRequestId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  CONSTRAINT "MetricsRequestBooking_pkey" PRIMARY KEY ("metricsRequestId","bookingId")
);
CREATE INDEX IF NOT EXISTS "MetricsRequestBooking_bookingId_idx" ON "MetricsRequestBooking"("bookingId");
DO $$ BEGIN
  ALTER TABLE "MetricsRequestBooking" ADD CONSTRAINT "MetricsRequestBooking_metricsRequestId_fkey" FOREIGN KEY ("metricsRequestId") REFERENCES "MetricsRequest"(id) ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "MetricsRequestBooking" ADD CONSTRAINT "MetricsRequestBooking_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "PublisherBooking"(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
```

- [ ] **Step 7: Generate client + typecheck**

Run: `pnpm prisma:generate && pnpm typecheck`
Expected: no errors (schema valid, client regenerated). `tsc` may flag the new `source` default in any code still referencing `"PUBLISHER"` — none exists yet except the publisher self-serve action; if `pnpm typecheck` flags `src/app/publisher-actions.ts` writing `source: "PUBLISHER"`, change it to `"PUBLISHER_FORM"`.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260607120000_campaign_reporting
git commit -m "feat(campaign): schema for flight dates, booking publisher anchor, metrics request"
```

---

## Phase 2 — Pure logic seams (TDD)

### Task 2: Token helper

**Files:**
- Create: `src/lib/campaign-reporting/tokens.ts`
- Test: `src/lib/campaign-reporting/tokens.test.ts`

> Mirrors `src/lib/outreach/tokens.ts`. (A future refactor could unify the three near-identical token modules — out of scope here to keep blast radius small.)

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newMetricsToken,
  metricsExpiryFromNow,
  checkMetricsRequest,
  metricsReportLink,
} from "./tokens";

test("newMetricsToken is url-safe and unique", () => {
  const a = newMetricsToken();
  const b = newMetricsToken();
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});

test("metricsExpiryFromNow adds days in UTC", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  assert.equal(metricsExpiryFromNow(30, now).toISOString(), "2026-07-01T00:00:00.000Z");
});

test("checkMetricsRequest verdicts", () => {
  const now = new Date("2026-06-10T00:00:00Z");
  assert.equal(checkMetricsRequest(null, now), null);
  assert.deepEqual(checkMetricsRequest({ expiresAt: new Date("2026-07-01T00:00:00Z"), respondedAt: null, cancelledAt: null }, now), { ok: true });
  assert.deepEqual(checkMetricsRequest({ expiresAt: new Date("2026-06-01T00:00:00Z"), respondedAt: null, cancelledAt: null }, now), { ok: false, reason: "expired" });
  assert.deepEqual(checkMetricsRequest({ expiresAt: new Date("2026-07-01T00:00:00Z"), respondedAt: new Date(), cancelledAt: null }, now), { ok: false, reason: "responded" });
  assert.deepEqual(checkMetricsRequest({ expiresAt: new Date("2026-07-01T00:00:00Z"), respondedAt: null, cancelledAt: new Date() }, now), { ok: false, reason: "cancelled" });
});

test("metricsReportLink builds a localized token URL", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://nativespin.com/";
  assert.equal(metricsReportLink("abc def", "no"), "https://nativespin.com/no/campaign-report/abc%20def");
});
```

- [ ] **Step 2: Run test, verify it fails** — `pnpm test 2>&1 | grep campaign-reporting/tokens` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 24;
export const DEFAULT_METRICS_TTL_DAYS = 45;

export function newMetricsToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function metricsExpiryFromNow(days = DEFAULT_METRICS_TTL_DAYS, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export type MetricsRequestShape = { expiresAt: Date; respondedAt: Date | null; cancelledAt: Date | null };
export type MetricsVerdict = { ok: true } | { ok: false; reason: "expired" | "responded" | "cancelled" };

export function checkMetricsRequest(req: MetricsRequestShape | null | undefined, now: Date = new Date()): MetricsVerdict | null {
  if (!req) return null;
  if (req.cancelledAt) return { ok: false, reason: "cancelled" };
  if (req.respondedAt) return { ok: false, reason: "responded" };
  if (req.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

export function metricsReportLink(token: string, locale = "en"): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
  return `${origin}/${locale}/campaign-report/${encodeURIComponent(token)}`;
}
```

- [ ] **Step 4: Run test, verify pass** — `pnpm test 2>&1 | grep -A2 campaign-reporting/tokens` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(campaign): metrics request token helper"`

### Task 3: Status, eligibility, grouping, recipient resolution

**Files:**
- Create: `src/lib/campaign-reporting/status.ts`
- Test: `src/lib/campaign-reporting/status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRequestStatus,
  isOrderEligibleForScan,
  groupBookingsByPublisher,
  resolveRecipient,
} from "./status";

test("computeRequestStatus: COMPLETE when every booking has impressions", () => {
  assert.equal(computeRequestStatus([{ impressions: 100 }, { impressions: 0 }]), "COMPLETE");
});
test("computeRequestStatus: PARTIAL when some but not all", () => {
  assert.equal(computeRequestStatus([{ impressions: 100 }, { impressions: null }]), "PARTIAL");
});
test("computeRequestStatus: PENDING when none reported", () => {
  assert.equal(computeRequestStatus([{ impressions: null }, { impressions: null }]), "PENDING");
  assert.equal(computeRequestStatus([]), "PENDING");
});

test("isOrderEligibleForScan: past flightEnd + grace, not cancelled", () => {
  const now = new Date("2026-06-12T08:00:00Z");
  // flight ends 2026-06-10; end-of-day + 1 grace => eligible from 2026-06-12T00:00Z
  assert.equal(isOrderEligibleForScan({ status: "LIVE", flightEndDate: new Date("2026-06-10T00:00:00Z") }, now, 1), true);
});
test("isOrderEligibleForScan: not yet past grace", () => {
  const now = new Date("2026-06-11T08:00:00Z");
  assert.equal(isOrderEligibleForScan({ status: "LIVE", flightEndDate: new Date("2026-06-10T00:00:00Z") }, now, 1), false);
});
test("isOrderEligibleForScan: cancelled or no flightEnd never eligible", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  assert.equal(isOrderEligibleForScan({ status: "CANCELLED", flightEndDate: new Date("2026-06-10T00:00:00Z") }, now, 1), false);
  assert.equal(isOrderEligibleForScan({ status: "LIVE", flightEndDate: null }, now, 1), false);
});

test("groupBookingsByPublisher: groups non-cancelled bookings with a publisher", () => {
  const groups = groupBookingsByPublisher([
    { id: "b1", publisherId: "p1", status: "PUBLISHED" },
    { id: "b2", publisherId: "p1", status: "CONFIRMED" },
    { id: "b3", publisherId: "p2", status: "PUBLISHED" },
    { id: "b4", publisherId: "p2", status: "CANCELLED" },
    { id: "b5", publisherId: null, status: "PUBLISHED" },
  ]);
  assert.deepEqual(groups, [
    { publisherId: "p1", bookingIds: ["b1", "b2"] },
    { publisherId: "p2", bookingIds: ["b3"] },
  ]);
});

test("resolveRecipient: prefers isPrimary, then first by email", () => {
  assert.deepEqual(
    resolveRecipient([
      { email: "b@x.no", name: "B", isPrimary: false },
      { email: "a@x.no", name: "A", isPrimary: true },
    ]),
    { email: "a@x.no", name: "A" },
  );
  assert.deepEqual(
    resolveRecipient([
      { email: "z@x.no", name: null, isPrimary: false },
      { email: "a@x.no", name: "A", isPrimary: false },
    ]),
    { email: "a@x.no", name: "A" },
  );
  assert.equal(resolveRecipient([]), null);
});
```

- [ ] **Step 2: Run, verify fail** — module not found.

- [ ] **Step 3: Implement `src/lib/campaign-reporting/status.ts`**

```ts
import type { MetricsRequestStatus, OrderStatus, BookingStatus } from "@prisma/client";

// COMPLETE when every covered booking has a non-null impressions value;
// PARTIAL when some do; PENDING when none. (Impressions is the required
// field — the open-ended metric set means "all fields" can never complete.)
export function computeRequestStatus(metrics: { impressions: number | null }[]): MetricsRequestStatus {
  if (metrics.length === 0) return "PENDING";
  const reported = metrics.filter((m) => m.impressions !== null).length;
  if (reported === 0) return "PENDING";
  return reported === metrics.length ? "COMPLETE" : "PARTIAL";
}

// End-of-day of flightEndDate + graceDays, in UTC. We never email "campaign's
// over" on the end date itself (markets span NO/SE/DK/FI/DE/AT/CH/UK/IE).
export function scanThreshold(flightEndDate: Date, graceDays: number): Date {
  const d = new Date(flightEndDate);
  d.setUTCHours(23, 59, 59, 999);
  d.setUTCDate(d.getUTCDate() + graceDays);
  return d;
}

const SCAN_EXCLUDED_STATUS = new Set<OrderStatus>(["QUOTED", "CANCELLED"]);

export function isOrderEligibleForScan(
  order: { status: OrderStatus; flightEndDate: Date | null },
  now: Date,
  graceDays: number,
): boolean {
  if (order.flightEndDate === null) return false;
  if (SCAN_EXCLUDED_STATUS.has(order.status)) return false;
  return now.getTime() > scanThreshold(order.flightEndDate, graceDays).getTime();
}

export function groupBookingsByPublisher(
  bookings: { id: string; publisherId: string | null; status: BookingStatus }[],
): { publisherId: string; bookingIds: string[] }[] {
  const byPub = new Map<string, string[]>();
  for (const b of bookings) {
    if (b.publisherId === null || b.status === "CANCELLED") continue;
    const list = byPub.get(b.publisherId) ?? [];
    list.push(b.id);
    byPub.set(b.publisherId, list);
  }
  return [...byPub.entries()].map(([publisherId, bookingIds]) => ({ publisherId, bookingIds }));
}

export function resolveRecipient(
  contacts: { email: string; name: string | null; isPrimary: boolean }[],
): { email: string; name: string | null } | null {
  if (contacts.length === 0) return null;
  const sorted = [...contacts].sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.email.localeCompare(b.email),
  );
  return { email: sorted[0].email, name: sorted[0].name };
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(campaign): status/eligibility/grouping/recipient pure helpers"`

### Task 4: Metric-write precedence + freeze snapshot

**Files:**
- Create: `src/lib/campaign-reporting/metrics-write.ts`
- Test: `src/lib/campaign-reporting/metrics-write.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canOverwrite, buildFreezeSnapshot } from "./metrics-write";

test("canOverwrite: DESK always wins", () => {
  assert.equal(canOverwrite("DESK", "DESK"), true);
  assert.equal(canOverwrite("PUBLISHER_FORM", "DESK"), false); // form cannot overwrite a desk value
});
test("canOverwrite: FORM beats EMAIL, EMAIL cannot overwrite FORM", () => {
  assert.equal(canOverwrite("PUBLISHER_FORM", "PUBLISHER_EMAIL"), true);
  assert.equal(canOverwrite("PUBLISHER_EMAIL", "PUBLISHER_FORM"), false);
});
test("canOverwrite: same source overwrites (latest reading wins)", () => {
  assert.equal(canOverwrite("PUBLISHER_EMAIL", "PUBLISHER_EMAIL"), true);
});
test("canOverwrite: any source writes a fresh (null existing) row", () => {
  assert.equal(canOverwrite("PUBLISHER_EMAIL", null), true);
});

test("buildFreezeSnapshot copies current impressions + first-party clicks, stamps frozenAt", () => {
  const now = new Date("2026-06-12T00:00:00Z");
  assert.deepEqual(
    buildFreezeSnapshot({ impressions: 5000 }, 320, now),
    { frozenAt: now, impressionsAtClose: 5000, clicksFirstPartyAtClose: 320 },
  );
  assert.deepEqual(
    buildFreezeSnapshot({ impressions: null }, 0, now),
    { frozenAt: now, impressionsAtClose: null, clicksFirstPartyAtClose: 0 },
  );
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```ts
import type { MetricsSource } from "@prisma/client";

// Higher rank wins. A new value may overwrite an existing one only when the
// incoming source rank >= the existing source rank. A desk override therefore
// never gets clobbered by a later form/email write; an AI email never clobbers
// a form value; same-source writes take the latest reading.
const RANK: Record<MetricsSource, number> = {
  PUBLISHER_EMAIL: 1,
  PUBLISHER_FORM: 2,
  DESK: 3,
};

export function canOverwrite(incoming: MetricsSource, existing: MetricsSource | null): boolean {
  if (existing === null) return true;
  return RANK[incoming] >= RANK[existing];
}

export function buildFreezeSnapshot(
  current: { impressions: number | null },
  firstPartyClicks: number,
  now: Date,
): { frozenAt: Date; impressionsAtClose: number | null; clicksFirstPartyAtClose: number } {
  return {
    frozenAt: now,
    impressionsAtClose: current.impressions,
    clicksFirstPartyAtClose: firstPartyClicks,
  };
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(campaign): metric write precedence + freeze snapshot"`

### Task 5: `ctrPct` reporting helper

**Files:**
- Modify: `src/lib/reporting.ts`
- Test: `src/lib/reporting.test.ts`

- [ ] **Step 1: Add the failing test** to `src/lib/reporting.test.ts`:

```ts
import { ctrPct } from "./reporting"; // add to existing import list

test("ctrPct: clicks/impressions to one decimal; guards zero/null denominator", () => {
  assert.equal(ctrPct(50, 1000), 5);
  assert.equal(ctrPct(1, 3), 33.3);
  assert.equal(ctrPct(10, 0), null);   // undefined CTR, not 0
  assert.equal(ctrPct(10, null), null);
  assert.equal(ctrPct(0, 1000), 0);
});
```

- [ ] **Step 2: Run, verify fail** — `ctrPct` not exported.

- [ ] **Step 3: Implement** — append to `src/lib/reporting.ts`:

```ts
// Click-through rate as a percentage with one decimal. Returns null (not 0)
// when impressions are missing/zero so the caller can show "—" instead of a
// misleading 0%. Compute per publisher over bookings with reported impressions.
export function ctrPct(clicks: number, impressions: number | null): number | null {
  if (impressions === null || impressions <= 0) return null;
  return Math.round((clicks / impressions) * 1000) / 10;
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(reporting): ctrPct helper"`

---

## Phase 3 — Orchestration (DB)

### Task 6: Email template

**Files:**
- Create: `src/lib/campaign-reporting/email.ts`
- Test: `src/lib/campaign-reporting/email.test.ts`

> Mirrors `buildOutreachEmail` shape (`{ subject, text }`). Reply-to plus-addressing is set by the sender, not the template.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMetricsEmail } from "./email";

test("buildMetricsEmail includes publisher name, link, placement count, and token ref", () => {
  const built = buildMetricsEmail({
    step: "initial",
    locale: "en",
    recipientName: "Kari",
    publisherName: "Acme Media",
    placementCount: 2,
    link: "https://nativespin.com/en/campaign-report/tok123",
    token: "tok123",
  });
  assert.match(built.subject, /Acme Media|campaign|results/i);
  assert.match(built.text, /tok123/);                 // token ref so AI reply attribution works
  assert.match(built.text, /campaign-report\/tok123/);
  assert.match(built.text, /Kari/);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** (English copy first; translations handled in Task 18 if templates move to i18n — for now copy is in-module like `buildOutreachEmail`):

```ts
export type MetricsLocale = "en" | "no" | "sv" | "da" | "fi" | "de";
export type MetricsStep = "initial" | "bump1" | "bump2";

export type MetricsEmailArgs = {
  step: MetricsStep;
  locale: MetricsLocale;
  recipientName: string | null;
  publisherName: string;
  placementCount: number;
  link: string;
  token: string;
};
export type Built = { subject: string; text: string };

export function buildMetricsEmail(a: MetricsEmailArgs): Built {
  const hi = a.recipientName ? `Hi ${a.recipientName},` : "Hi,";
  const n = a.placementCount;
  const placements = n === 1 ? "the placement" : `your ${n} placements`;
  const subjectBase = `Campaign results for ${a.publisherName}`;
  const subject =
    a.step === "initial" ? subjectBase :
    a.step === "bump1" ? `Reminder: ${subjectBase}` :
    `Final reminder: ${subjectBase}`;
  const text = [
    hi,
    "",
    `The campaign that ran on ${a.publisherName} has ended. To close the loop with the advertiser, could you share the performance numbers for ${placements}?`,
    "",
    `Report them here (takes a minute): ${a.link}`,
    "",
    "You can also just reply to this email with the figures and we'll record them.",
    "",
    `[ref: ${a.token}]`,
    "",
    "Thank you,",
    "NativeSpin",
  ].join("\n");
  return { subject, text };
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(campaign): metrics follow-up email template"`

### Task 7: Campaign orchestration module (build / send / batch / find)

**Files:**
- Create: `src/lib/campaign-reporting/campaign.ts`
- Test: `src/lib/campaign-reporting/campaign.it.test.ts` (DB integration; see `src/lib/content-fee.it.test.ts` for the harness)

- [ ] **Step 1: Implement `buildMetricsCampaign`** (no test-first for DB plumbing that mostly composes already-tested pure helpers; the integration test in Step 4 covers it):

```ts
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { newMetricsToken, metricsExpiryFromNow, metricsReportLink } from "./tokens";
import {
  isOrderEligibleForScan,
  groupBookingsByPublisher,
  resolveRecipient,
  computeRequestStatus,
} from "./status";
import { buildMetricsEmail, type MetricsLocale } from "./email";
import { localeForMarketCode } from "@/lib/outreach/email";
import { isSuppressed } from "@/lib/outreach/suppression";
import { emailAdapter } from "@/lib/notify";
import { stepKindForCount, nextStepDate, MAX_STEPS } from "@/lib/outreach/sequence";
import { outreachLimiter } from "@/lib/rate-limit";
import { clicksByOrderLine } from "@/lib/metrics/store";
import { buildFreezeSnapshot } from "./metrics-write";

const GRACE_DAYS = 1;

export async function buildMetricsCampaign(args: {
  createdById: string;
  now?: Date;
}): Promise<{ requests_created: number; needs_contact: number; orders_scanned: number }> {
  const now = args.now ?? new Date();
  const orders = await prisma.order.findMany({
    where: { flightEndDate: { not: null }, status: { notIn: ["QUOTED", "CANCELLED"] } },
    select: {
      id: true, status: true, flightEndDate: true,
      lines: {
        select: {
          booking: {
            select: {
              id: true, publisherId: true, status: true,
              title: { select: { market: { select: { code: true } } } },
            },
          },
        },
      },
    },
  });

  let created = 0, needsContact = 0, scanned = 0;
  for (const order of orders) {
    if (!isOrderEligibleForScan(order, now, GRACE_DAYS)) continue;
    scanned++;
    const bookings = order.lines.map((l) => l.booking).filter((b): b is NonNullable<typeof b> => !!b);
    const groups = groupBookingsByPublisher(bookings);
    for (const g of groups) {
      const existing = await prisma.metricsRequest.findUnique({
        where: { orderId_publisherId: { orderId: order.id, publisherId: g.publisherId } },
      });
      if (existing) continue;

      const contacts = await prisma.salesContactTitle.findMany({
        where: { salesContact: { publisherId: g.publisherId }, title: { bookings: { some: { id: { in: g.bookingIds } } } } },
        select: { isPrimary: true, salesContact: { select: { email: true, name: true } } },
      });
      const recipient = resolveRecipient(
        contacts.map((c) => ({ email: c.salesContact.email, name: c.salesContact.name, isPrimary: c.isPrimary })),
      );

      // Dominant locale from the bookings' markets.
      const groupBookings = bookings.filter((b) => g.bookingIds.includes(b.id));
      const locCount = new Map<MetricsLocale, number>();
      for (const b of groupBookings) {
        if (!b.title?.market) continue;
        const loc = localeForMarketCode(b.title.market.code) as MetricsLocale;
        locCount.set(loc, (locCount.get(loc) ?? 0) + 1);
      }
      const locale = [...locCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "en";

      const req = await prisma.metricsRequest.create({
        data: {
          orderId: order.id,
          publisherId: g.publisherId,
          recipientEmail: recipient?.email ?? null,
          recipientName: recipient?.name ?? null,
          locale,
          token: newMetricsToken(),
          status: recipient ? "PENDING" : "NEEDS_CONTACT",
          expiresAt: metricsExpiryFromNow(),
          createdById: args.createdById,
          bookings: { create: g.bookingIds.map((bookingId) => ({ bookingId })) },
        },
      });
      if (recipient) created++; else needsContact++;
      await recordAudit(args.createdById, "metrics_request.create", `MetricsRequest:${req.id}`, {
        orderId: order.id, publisherId: g.publisherId, bookings: g.bookingIds.length, hasContact: !!recipient,
      });
    }
  }
  return { requests_created: created, needs_contact: needsContact, orders_scanned: scanned };
}
```

- [ ] **Step 2: Implement `sendMetricsRequestStep` + `selectMetricsBatchForSend`** in the same file:

```ts
export async function selectMetricsBatchForSend(args: { limit: number }) {
  const now = new Date();
  return prisma.metricsRequest.findMany({
    where: {
      status: { in: ["PENDING", "PARTIAL"] },
      recipientEmail: { not: null },
      respondedAt: null, cancelledAt: null,
      expiresAt: { gt: now },
      sentCount: { lt: MAX_STEPS },
      OR: [{ sentCount: 0 }, { nextStepAt: { lte: now } }],
    },
    orderBy: [{ nextStepAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: args.limit,
  });
}

export async function sendMetricsRequestStep(args: { requestId: string; actorId: string }): Promise<
  | { sent: "initial" | "bump1" | "bump2" }
  | { skipped: "responded" | "cancelled" | "expired" | "max_steps" | "no_contact" | "suppressed" | "rate_limited" }
> {
  const req = await prisma.metricsRequest.findUnique({
    where: { id: args.requestId },
    include: { publisher: { select: { name: true } }, bookings: true },
  });
  if (!req) throw new Error("metrics_request.not_found");
  if (req.respondedAt) return { skipped: "responded" };
  if (req.cancelledAt) return { skipped: "cancelled" };
  if (req.expiresAt <= new Date()) return { skipped: "expired" };
  if (req.sentCount >= MAX_STEPS) return { skipped: "max_steps" };
  if (!req.recipientEmail) return { skipped: "no_contact" };

  // Suppression: block hard bounces (dead address), but allow a marketing
  // unsubscribe through — this is a transactional follow-up on a fulfilled order.
  const supp = await prisma.outreachSuppression.findUnique({ where: { email: req.recipientEmail } });
  if (supp && supp.reason !== "unsubscribe") {
    await recordAudit(args.actorId, "metrics.skipped_suppressed", `MetricsRequest:${req.id}`, { to: req.recipientEmail, reason: supp.reason });
    return { skipped: "suppressed" };
  }

  const limited = await outreachLimiter.check("metrics-send");
  if (!limited.ok) return { skipped: "rate_limited" };

  const step = stepKindForCount(req.sentCount);
  const link = metricsReportLink(req.token, req.locale);
  const built = buildMetricsEmail({
    step, locale: req.locale as MetricsLocale, recipientName: req.recipientName,
    publisherName: req.publisher.name, placementCount: req.bookings.length, link, token: req.token,
  });

  // Per-request reply-to plus-addressing so an inbound AI-parsed reply maps to
  // this exact request (Task 13). Falls back to OUTREACH_REPLY_TO if no base set.
  const replyBase = process.env.METRICS_REPLY_TO ?? process.env.OUTREACH_REPLY_TO ?? "";
  const replyTo = replyBase.includes("@") ? replyBase.replace("@", `+${req.token}@`) : replyBase;

  await emailAdapter({
    to: req.recipientEmail, subject: built.subject, text: built.text,
    from: process.env.OUTREACH_FROM, replyTo: replyTo || undefined,
  });

  const now = new Date();
  await prisma.metricsRequest.update({
    where: { id: req.id },
    data: { sentCount: req.sentCount + 1, lastStepAt: now, nextStepAt: nextStepDate(step, now), sentAt: req.sentAt ?? now },
  });
  await recordAudit(args.actorId, `metrics_request.send.${step}`, `MetricsRequest:${req.id}`, { to: req.recipientEmail });
  return { sent: step };
}

export async function findMetricsRequestByToken(token: string) {
  return prisma.metricsRequest.findUnique({
    where: { token },
    include: {
      publisher: { select: { name: true } },
      bookings: {
        include: {
          booking: {
            include: {
              metrics: true,
              orderLine: { select: { id: true } },
              title: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}
```

- [ ] **Step 3: Write the integration test** `src/lib/campaign-reporting/campaign.it.test.ts` (mirror the setup/teardown in `src/lib/content-fee.it.test.ts`). Cover:

```
- seed: publisher + title + market + product + org + order(flightEndDate in past, status LIVE)
        + 2 INVENTORY orderLines + bookings (publisherId set) + a SalesContact w/ SalesContactTitle.
- buildMetricsCampaign({createdById}) → requests_created === 1; one MetricsRequest with 2 MetricsRequestBooking rows; recipientEmail frozen.
- run again → requests_created === 0 (idempotent via @@unique).
- order with no SalesContact → status === "NEEDS_CONTACT", recipientEmail null, not in selectMetricsBatchForSend.
- order with only CONTENT_FEE lines (no bookings) → 0 requests.
- CANCELLED order past flightEnd → 0 requests.
- selectMetricsBatchForSend({limit:10}) returns the PENDING request with a contact.
```

Use a fake `emailAdapter` by setting `process.env` mail adapter to a no-op, or assert at the `selectMetricsBatchForSend` layer to avoid sending. Follow whatever the rate-card tests do for the mail adapter.

- [ ] **Step 4: Run** — `pnpm test 2>&1 | grep -A3 campaign-reporting/campaign` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(campaign): build/send/select metrics request orchestration"`

### Task 8: `writeBookingMetric` + `freezeDueCampaigns` + `ingestMetricsReply`

**Files:**
- Modify: `src/lib/campaign-reporting/campaign.ts`
- Test: extend `src/lib/campaign-reporting/campaign.it.test.ts`

- [ ] **Step 1: Implement `writeBookingMetric`** (shared by form, email, desk; enforces precedence):

```ts
import { canOverwrite } from "./metrics-write";
import type { MetricsSource } from "@prisma/client";

export type MetricFields = {
  impressions?: number | null;
  pageViews?: number | null;
  publisherReportedClicks?: number | null;
  avgTimeSec?: number | null;
  scrollDepthPct?: number | null;
  extra?: Record<string, unknown> | null;
  windowStart?: Date | null;
  windowEnd?: Date | null;
};

export async function writeBookingMetric(args: {
  bookingId: string;
  source: MetricsSource;
  reportedBy: string;
  note?: string | null;
  fields: MetricFields;
  now?: Date;
}): Promise<{ written: boolean }> {
  const now = args.now ?? new Date();
  const existing = await prisma.bookingMetrics.findUnique({ where: { bookingId: args.bookingId }, select: { source: true, frozenAt: true } });
  if (existing && !canOverwrite(args.source, existing.source)) return { written: false };

  const data = {
    ...args.fields,
    extra: args.fields.extra === undefined ? undefined : (args.fields.extra as never),
    source: args.source,
    reportedBy: args.reportedBy,
    note: args.note ?? undefined,
    reportedAt: now,
  };
  await prisma.bookingMetrics.upsert({
    where: { bookingId: args.bookingId },
    create: { bookingId: args.bookingId, ...data },
    update: data,
  });
  return { written: true };
}
```

- [ ] **Step 2: Implement `recomputeRequestStatus`** (call after any write):

```ts
export async function recomputeRequestStatus(metricsRequestId: string): Promise<void> {
  const req = await prisma.metricsRequest.findUnique({
    where: { id: metricsRequestId },
    include: { bookings: { include: { booking: { select: { metrics: { select: { impressions: true } } } } } } },
  });
  if (!req) return;
  if (req.status === "CANCELLED" || req.status === "EXPIRED" || req.status === "NEEDS_CONTACT") return;
  const status = computeRequestStatus(req.bookings.map((b) => ({ impressions: b.booking.metrics?.impressions ?? null })));
  const respondedAt = status === "PENDING" ? req.respondedAt : req.respondedAt ?? new Date();
  await prisma.metricsRequest.update({ where: { id: req.id }, data: { status, respondedAt } });
}
```

- [ ] **Step 3: Implement `freezeDueCampaigns`** (snapshot at close):

```ts
// Freeze any not-yet-frozen booking whose order's flight ended (+grace). The
// snapshot is the reproducible campaign number; live-to-date keeps updating.
export async function freezeDueCampaigns(args: { now?: Date }): Promise<{ frozen: number }> {
  const now = args.now ?? new Date();
  const requests = await prisma.metricsRequest.findMany({
    where: { order: { flightEndDate: { not: null }, status: { notIn: ["QUOTED", "CANCELLED"] } } },
    select: {
      order: { select: { flightEndDate: true, status: true } },
      bookings: { select: { booking: { select: { id: true, orderLineId: true, metrics: { select: { impressions: true, frozenAt: true } } } } } },
    },
  });
  let frozen = 0;
  for (const req of requests) {
    if (!isOrderEligibleForScan(req.order, now, GRACE_DAYS)) continue;
    for (const rb of req.bookings) {
      const b = rb.booking;
      if (b.metrics?.frozenAt) continue;
      const clicks = (await clicksByOrderLine([b.orderLineId]))[b.orderLineId] ?? 0;
      const snap = buildFreezeSnapshot({ impressions: b.metrics?.impressions ?? null }, clicks, now);
      await prisma.bookingMetrics.upsert({
        where: { bookingId: b.id },
        create: { bookingId: b.id, source: "DESK", reportedBy: "system:freeze", ...snap },
        update: snap,
      });
      frozen++;
    }
  }
  return { frozen };
}
```

- [ ] **Step 4: Implement `ingestMetricsReply`** (AI email path; idempotent on msgid):

```ts
import { createContactLog } from "@/lib/pricing/contact-log"; // adjust import to the actual export

// Attribute a parsed publisher reply to its request and write metrics.
// `byBooking` maps bookingId -> parsed fields; the caller (AI extractor)
// resolves which booking when the publisher has multiple placements, else
// passes a single entry. Idempotent: re-ingesting the same msgid is a no-op.
export async function ingestMetricsReply(args: {
  token: string;
  msgid: string;
  byBooking: { bookingId: string; fields: MetricFields; rawQuote: string }[];
  actorId?: string;
}): Promise<{ status: "written" | "duplicate" | "unmatched" | "ambiguous" }> {
  const req = await prisma.metricsRequest.findUnique({
    where: { token: args.token },
    include: { bookings: { select: { bookingId: true } } },
  });
  if (!req) return { status: "unmatched" };

  const reportedBy = `email:${args.msgid}`;
  // Idempotency: if any metric for these bookings already records this msgid, stop.
  const dup = await prisma.bookingMetrics.findFirst({
    where: { bookingId: { in: req.bookings.map((b) => b.bookingId) }, reportedBy },
    select: { id: true },
  });
  if (dup) return { status: "duplicate" };

  // Multi-placement + unattributed reply → flag for desk rather than guess.
  if (req.bookings.length > 1 && args.byBooking.length === 0) return { status: "ambiguous" };

  for (const entry of args.byBooking) {
    await writeBookingMetric({
      bookingId: entry.bookingId, source: "PUBLISHER_EMAIL", reportedBy,
      note: entry.rawQuote, fields: entry.fields,
    });
  }
  await recomputeRequestStatus(req.id);
  return { status: "written" };
}
```

> If `createContactLog`'s signature differs, drop the import; the metric write + audit is the source of truth. Verify `src/lib/pricing/contact-log.ts` exports before wiring the ContactLog line.

- [ ] **Step 5: Extend the integration test** to cover: `writeBookingMetric` precedence (DESK write then PUBLISHER_EMAIL write → second returns `{written:false}` and value unchanged); `recomputeRequestStatus` flips PENDING→PARTIAL→COMPLETE; `freezeDueCampaigns` sets `frozenAt` + `clicksFirstPartyAtClose` and is a no-op on a second run; `ingestMetricsReply` writes once and returns `"duplicate"` on the same msgid.

- [ ] **Step 6: Run, verify pass. Commit** — `git commit -am "feat(campaign): metric write, status recompute, freeze, email ingest"`

### Task 9: Set `publisherId`/`titleId` at booking creation

**Files:**
- Modify: `src/lib/commerce/firm-order.ts` (booking `createMany` near line 204)

- [ ] **Step 1: Replace the booking create** so each booking carries its publisher/title:

```ts
// Resolve title/publisher for placement lines so each booking is anchored to
// its publisher at creation (the campaign report groups by it).
const placementProductIds = placementLines.map((l) => l.productId).filter((id): id is string => !!id);
const placementProducts = await tx.product.findMany({
  where: { id: { in: placementProductIds } },
  select: { id: true, titleId: true, title: { select: { publisherId: true } } },
});
const titleByProduct = new Map(placementProducts.map((p) => [p.id, { titleId: p.titleId, publisherId: p.title.publisherId }]));

await tx.publisherBooking.createMany({
  data: placementLines.map((l) => {
    const ref = l.productId ? titleByProduct.get(l.productId) : undefined;
    return { orderLineId: l.id, titleId: ref?.titleId ?? null, publisherId: ref?.publisherId ?? null };
  }),
});
```

- [ ] **Step 2: Typecheck + run existing firm-order tests** — `pnpm typecheck && pnpm test 2>&1 | grep -A3 firm-order` → PASS.
- [ ] **Step 3: Commit** — `git commit -am "feat(campaign): anchor publisher/title on booking creation"`

---

## Phase 4 — Scripts + cron

### Task 10: CLI scripts + package.json

**Files:**
- Create: `scripts/build-metrics-campaign.ts`, `scripts/send-metrics-batch.ts`, `scripts/freeze-metrics-campaigns.ts`
- Modify: `package.json`

- [ ] **Step 1: `scripts/build-metrics-campaign.ts`** (mirror `build-rate-card-campaign.ts`):

```ts
#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { buildMetricsCampaign, freezeDueCampaigns } from "@/lib/campaign-reporting/campaign";

async function main() {
  const operator = await prisma.user.findFirstOrThrow({ where: { role: "SUPERADMIN" } });
  const built = await buildMetricsCampaign({ createdById: operator.id });
  const frozen = await freezeDueCampaigns({});
  console.log(`[metrics-build] created=${built.requests_created} needsContact=${built.needs_contact} scanned=${built.orders_scanned} frozen=${frozen.frozen}`);
  await prisma.$disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: `scripts/send-metrics-batch.ts`** (mirror `send-rate-card-batch.ts`):

```ts
#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { selectMetricsBatchForSend, sendMetricsRequestStep } from "@/lib/campaign-reporting/campaign";

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : parseInt(process.env.METRICS_DAILY_CAP ?? "30", 10);
  const dryRun = process.argv.includes("--dry-run");
  const operator = await prisma.user.findFirstOrThrow({ where: { role: "SUPERADMIN" } });
  const batch = await selectMetricsBatchForSend({ limit });
  console.log(`[metrics-send] selected ${batch.length} (limit=${limit} dry-run=${dryRun})`);
  let sent = 0; const skipped: Record<string, number> = {};
  for (const r of batch) {
    if (dryRun) { console.log(`  - ${r.recipientEmail} sentCount=${r.sentCount}`); continue; }
    const res = await sendMetricsRequestStep({ requestId: r.id, actorId: operator.id });
    if ("sent" in res) { sent++; console.log(`  ✓ ${r.recipientEmail} (${res.sent})`); }
    else { skipped[res.skipped] = (skipped[res.skipped] ?? 0) + 1; if (res.skipped === "rate_limited") break; }
  }
  console.log(`[metrics-send] sent=${sent} skipped=${JSON.stringify(skipped)}`);
  await prisma.$disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: `scripts/freeze-metrics-campaigns.ts`** (standalone freeze, for an independent cron cadence):

```ts
#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { freezeDueCampaigns } from "@/lib/campaign-reporting/campaign";

async function main() {
  const res = await freezeDueCampaigns({});
  console.log(`[metrics-freeze] frozen=${res.frozen}`);
  await prisma.$disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 4: Add to `package.json` scripts** (after `send-rate-card-batch`):

```json
    "build-metrics-campaign": "tsx scripts/build-metrics-campaign.ts",
    "send-metrics-batch": "tsx scripts/send-metrics-batch.ts",
    "freeze-metrics-campaigns": "tsx scripts/freeze-metrics-campaigns.ts",
```

- [ ] **Step 5: Smoke-run** — `pnpm build-metrics-campaign` against a DB with a past-flight order → prints a summary without throwing. (Read-only-ish; safe.)
- [ ] **Step 6: Commit** — `git commit -am "feat(campaign): build/send/freeze CLI scripts"`

> **Cron wiring (ops, document in PR):** schedule `pnpm build-metrics-campaign` and `pnpm send-metrics-batch` daily (e.g. 07:00 and 07:15 UTC) via Railway cron / the platform's CronCreate hitting an idempotent ops endpoint. Both are safe to run repeatedly.

---

## Phase 5 — Self-serve form

### Task 11: `campaign-report/[token]` page + form + action

**Files:**
- Create: `src/app/[locale]/campaign-report/[token]/page.tsx`
- Create: `src/app/[locale]/campaign-report/[token]/actions.ts`
- Create: `src/app/[locale]/campaign-report/[token]/_components/MetricsForm.tsx`
- Create: `src/app/[locale]/campaign-report/[token]/thanks/page.tsx`

- [ ] **Step 1: `actions.ts`** (mirror `rate-card/[token]/actions.ts`):

```ts
"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { findMetricsRequestByToken, writeBookingMetric, recomputeRequestStatus } from "@/lib/campaign-reporting/campaign";
import { checkMetricsRequest } from "@/lib/campaign-reporting/tokens";
import { recordAudit } from "@/lib/audit";
import { rfqLimiter } from "@/lib/rate-limit";

function num(fd: FormData, k: string): number | null {
  const v = fd.get(k);
  if (typeof v !== "string" || v.trim() === "") return null;
  return /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
}
function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
}

export async function submitCampaignReportAction(formData: FormData) {
  const token = str(formData, "token");
  const locale = str(formData, "locale") || "en";
  const ip = await clientIp();
  const limited = await rfqLimiter.check(`metrics-submit:${ip}:${token.slice(0, 16)}`);
  if (!limited.ok) redirect(`/${locale}/campaign-report/${token}?error=rate`);

  const req = await findMetricsRequestByToken(token);
  if (!req) redirect(`/${locale}/campaign-report/${token}`);
  const verdict = checkMetricsRequest({ expiresAt: req.expiresAt, respondedAt: req.respondedAt, cancelledAt: req.cancelledAt });
  if (!verdict?.ok) redirect(`/${locale}/campaign-report/${token}`);

  let wrote = 0;
  for (const rb of req.bookings) {
    const id = rb.bookingId;
    const fields = {
      impressions: num(formData, `m[${id}].impressions`),
      pageViews: num(formData, `m[${id}].pageViews`),
      publisherReportedClicks: num(formData, `m[${id}].clicks`),
      avgTimeSec: num(formData, `m[${id}].avgTimeSec`),
      scrollDepthPct: num(formData, `m[${id}].scrollDepthPct`),
    };
    const tracking = str(formData, `m[${id}].publisherTrackingUrl`);
    if (tracking) await prisma.publisherBooking.update({ where: { id }, data: { publisherTrackingUrl: tracking } });
    const hasAny = Object.values(fields).some((v) => v !== null);
    if (!hasAny && !tracking) continue;
    if (hasAny) { await writeBookingMetric({ bookingId: id, source: "PUBLISHER_FORM", reportedBy: `metrics-form:${req.id}`, fields }); wrote++; }
  }
  await recomputeRequestStatus(req.id);
  await recordAudit(`metrics:${req.recipientEmail ?? req.id}`, "metrics.submit", `MetricsRequest:${req.id}`, { bookings: wrote, source: "FORM" });
  redirect(`/${locale}/campaign-report/${token}/thanks`);
}
```

- [ ] **Step 2: `_components/MetricsForm.tsx`** — client component, one fieldset per booking from `req.bookings`. For each booking render number inputs (`m[${bookingId}].impressions`, `.pageViews`, `.clicks`, `.avgTimeSec`, `.scrollDepthPct`) prefilled from `booking.metrics`, plus a `publisherTrackingUrl` text input prefilled from `booking.publisherTrackingUrl`, and a read-only line showing `booking.title.name` + `booking.liveUrl`. Hidden inputs `token` and `locale`. Submit posts to `submitCampaignReportAction`. Mirror the markup conventions of `rate-card/[token]/_components/RateCardForm.tsx` (Tailwind, `SubmitButton`).

```tsx
"use client";
import { submitCampaignReportAction } from "../actions";
import { SubmitButton } from "@/components";

type BookingRow = {
  bookingId: string;
  titleName: string;
  liveUrl: string | null;
  publisherTrackingUrl: string | null;
  metrics: { impressions: number | null; pageViews: number | null; publisherReportedClicks: number | null; avgTimeSec: number | null; scrollDepthPct: number | null } | null;
};

export function MetricsForm({ token, locale, bookings, t }: {
  token: string; locale: string; bookings: BookingRow[];
  t: (k: string) => string;
}) {
  return (
    <form action={submitCampaignReportAction} className="mt-6 space-y-8">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      {bookings.map((b) => (
        <fieldset key={b.bookingId} className="border rounded-lg p-4">
          <legend className="px-1 font-medium">{b.titleName}</legend>
          {b.liveUrl ? <a href={b.liveUrl} className="text-sm underline" target="_blank" rel="noreferrer">{b.liveUrl}</a> : null}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberInput name={`m[${b.bookingId}].impressions`} label={t("impressions")} value={b.metrics?.impressions} />
            <NumberInput name={`m[${b.bookingId}].pageViews`} label={t("pageViews")} value={b.metrics?.pageViews} />
            <NumberInput name={`m[${b.bookingId}].clicks`} label={t("clicks")} value={b.metrics?.publisherReportedClicks} />
            <NumberInput name={`m[${b.bookingId}].avgTimeSec`} label={t("avgTimeSec")} value={b.metrics?.avgTimeSec} />
            <NumberInput name={`m[${b.bookingId}].scrollDepthPct`} label={t("scrollDepthPct")} value={b.metrics?.scrollDepthPct} />
          </div>
          <label className="mt-3 block text-sm">{t("publisherTrackingUrl")}
            <input name={`m[${b.bookingId}].publisherTrackingUrl`} defaultValue={b.publisherTrackingUrl ?? ""} className="mt-1 w-full border rounded px-2 py-1" />
          </label>
        </fieldset>
      ))}
      <SubmitButton>{t("submit")}</SubmitButton>
    </form>
  );
}

function NumberInput({ name, label, value }: { name: string; label: string; value: number | null | undefined }) {
  return (
    <label className="block text-sm">{label}
      <input name={name} inputMode="numeric" pattern="\d*" defaultValue={value ?? ""} className="mt-1 w-full border rounded px-2 py-1" />
    </label>
  );
}
```

- [ ] **Step 3: `page.tsx`** — mirror `rate-card/[token]/page.tsx`: resolve token via `findMetricsRequestByToken`, verdict via `checkMetricsRequest`, render not-found/expired/responded/cancelled states, else render `<MetricsForm>` mapping `req.bookings` to `BookingRow[]`. `export const dynamic = "force-dynamic"`. Use `getTranslations({ locale, namespace: "campaignReport" })`.

```tsx
import { getTranslations } from "next-intl/server";
import { findMetricsRequestByToken } from "@/lib/campaign-reporting/campaign";
import { checkMetricsRequest } from "@/lib/campaign-reporting/tokens";
import { MetricsForm } from "./_components/MetricsForm";

export const dynamic = "force-dynamic";

export default async function CampaignReportPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: "campaignReport" });
  const req = await findMetricsRequestByToken(token);
  if (!req) return <main className="p-8 max-w-prose mx-auto"><h1 className="text-xl font-semibold">{t("pageTitle")}</h1><p className="mt-2">{t("statusNotFound")}</p></main>;
  const verdict = checkMetricsRequest({ expiresAt: req.expiresAt, respondedAt: req.respondedAt, cancelledAt: req.cancelledAt });
  if (!verdict?.ok) {
    const reason = verdict ? verdict.reason : "expired";
    const key = reason === "responded" ? "statusResponded" : reason === "cancelled" ? "statusCancelled" : "statusExpired";
    return <main className="p-8 max-w-prose mx-auto"><h1 className="text-xl font-semibold">{t("pageTitle")}</h1><p className="mt-2">{t(key)}</p></main>;
  }
  const bookings = req.bookings.map((rb) => ({
    bookingId: rb.bookingId,
    titleName: rb.booking.title?.name ?? "—",
    liveUrl: rb.booking.liveUrl,
    publisherTrackingUrl: rb.booking.publisherTrackingUrl,
    metrics: rb.booking.metrics,
  }));
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
      <p className="mt-2 text-gray-600">{t("intro", { publisher: req.publisher.name })}</p>
      <MetricsForm token={token} locale={locale} bookings={bookings} t={t} />
    </main>
  );
}
```

- [ ] **Step 4: `thanks/page.tsx`** — simple confirmation page (mirror `rate-card/[token]/thanks`).

- [ ] **Step 5: Typecheck + manual verify** — `pnpm typecheck`; then `pnpm dev` (project port, NOT 3000), create a test MetricsRequest, open `/en/campaign-report/<token>`, submit numbers, confirm `BookingMetrics` rows written and status flips to PARTIAL/COMPLETE.
- [ ] **Step 6: Commit** — `git commit -am "feat(campaign): publisher self-serve metrics form"`

---

## Phase 6 — Desk surface

### Task 12: Desk order Campaign section

**Files:**
- Modify: `src/app/[locale]/desk/orders/[orderId]/page.tsx` (extend query; render section)
- Create: `src/app/[locale]/desk/orders/[orderId]/campaign-section.tsx`
- Modify: `src/app/desk-actions.ts`

- [ ] **Step 1: Extend the order query** in `page.tsx` — add to `lines.include`:

```ts
          booking: { include: { metrics: true, publisher: { select: { name: true } }, title: { select: { name: true } } } },
```

and after the order fetch add the per-publisher request + click data:

```ts
import { clicksByOrderLine } from "@/lib/metrics/store";
// ...
const metricsRequests = await prisma.metricsRequest.findMany({
  where: { orderId: order.id },
  select: { id: true, publisherId: true, status: true, recipientEmail: true, sentCount: true, token: true },
});
const clicks = await clicksByOrderLine(order.lines.map((l) => l.id));
```

- [ ] **Step 2: Add the new server actions** to `src/app/desk-actions.ts`:

```ts
// ---- Campaign reporting (desk) ----
export async function saveFlightWindow(orderId: string, fd: FormData) {
  const session = await auth();
  if (session?.user?.role !== "DESK" && session?.user?.role !== "SUPERADMIN") throw new Error("forbidden");
  const start = String(fd.get("flightStartDate") ?? "");
  const end = String(fd.get("flightEndDate") ?? "");
  await prisma.order.update({ where: { id: orderId }, data: {
    flightStartDate: start ? new Date(start) : null,
    flightEndDate: end ? new Date(end) : null,
  }});
  await recordAudit(session.user.id, "order.flight_window.save", `Order:${orderId}`, { start, end });
  revalidatePath(`/desk/orders/${orderId}`);
}

export async function saveBookingMetricOverride(bookingId: string, fd: FormData) {
  const session = await auth();
  if (session?.user?.role !== "DESK" && session?.user?.role !== "SUPERADMIN") throw new Error("forbidden");
  const num = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return v === "" ? null : (/^\d+$/.test(v) ? Number(v) : null); };
  await writeBookingMetric({
    bookingId, source: "DESK", reportedBy: session.user.id,
    fields: { impressions: num("impressions"), pageViews: num("pageViews"), publisherReportedClicks: num("clicks"), avgTimeSec: num("avgTimeSec"), scrollDepthPct: num("scrollDepthPct") },
  });
  const rb = await prisma.metricsRequestBooking.findFirst({ where: { bookingId }, select: { metricsRequestId: true } });
  if (rb) await recomputeRequestStatus(rb.metricsRequestId);
  revalidatePath(`/desk/orders/${(await prisma.publisherBooking.findUnique({ where: { id: bookingId }, select: { orderLine: { select: { orderId: true } } } }))?.orderLine.orderId}`);
}

export async function resendMetricsRequest(requestId: string) {
  const session = await auth();
  if (session?.user?.role !== "DESK" && session?.user?.role !== "SUPERADMIN") throw new Error("forbidden");
  await sendMetricsRequestStep({ requestId, actorId: session.user.id }); // reuses token, bumps sentCount
}
```

Add imports at the top of `desk-actions.ts`:

```ts
import { writeBookingMetric, recomputeRequestStatus, sendMetricsRequestStep } from "@/lib/campaign-reporting/campaign";
```

- [ ] **Step 3: `campaign-section.tsx`** — server component rendering: flight-window form (posts `saveFlightWindow`), then per-publisher groups (from `order.lines[].booking` grouped by `booking.publisher.name`), each row showing live dates, `liveUrl`, our clicks (`clicks[line.id]`), `publisherTrackingUrl`, reported metrics + `source` badge, frozen values if `frozenAt`, the matching `MetricsRequest.status`, a resend button, and an inline override form (posts `saveBookingMetricOverride`). Take `order`, `metricsRequests`, `clicks`, and the translator as props. Render markup in the project's desk style.

- [ ] **Step 4: Render `<CampaignSection>`** in `page.tsx` below the existing lines section.

- [ ] **Step 5: Typecheck + manual verify** — `pnpm typecheck`; open a desk order, set the flight window, override a number, confirm it persists and wins over a prior form value.
- [ ] **Step 6: Commit** — `git commit -am "feat(campaign): desk order campaign section"`

### Task 13: NEEDS_CONTACT queue

**Files:**
- Create: `src/app/[locale]/desk/metrics-needs-contact/page.tsx`
- Modify: desk nav (wherever desk links live — follow `desk/writers` nav entry added in recent commits)

- [ ] **Step 1: Page** — list `MetricsRequest` where `status = "NEEDS_CONTACT"`, with order id, publisher name, booking count, and a link to the desk order page so the desk can add a contact and re-run the scan.

```tsx
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export default async function MetricsNeedsContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "desk" });
  const rows = await prisma.metricsRequest.findMany({
    where: { status: "NEEDS_CONTACT" },
    include: { publisher: { select: { name: true } }, order: { select: { id: true } }, _count: { select: { bookings: true } } },
    orderBy: { createdAt: "desc" },
  });
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">{t("metricsNeedsContactTitle")}</h1>
      <table className="mt-4 w-full text-sm">
        <thead><tr><th className="text-left">Publisher</th><th>Placements</th><th>Order</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td>{r.publisher.name}</td>
              <td className="text-center">{r._count.bookings}</td>
              <td><Link href={`/desk/orders/${r.order.id}`} className="underline">{r.order.id.slice(0, 8)}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Add a desk nav link** to this page (match the pattern used for the Writers desk entry).
- [ ] **Step 3: Typecheck + commit** — `git commit -am "feat(campaign): desk NEEDS_CONTACT queue"`

---

## Phase 7 — Advertiser report + export

### Task 14: Campaign report section (buyer)

**Files:**
- Modify: `src/app/[locale]/orders/[orderId]/page.tsx`

- [ ] **Step 1: Verify org scoping** — confirm the page already gates by `ws.scopeOrgIds` (as `requests/[id]/page.tsx` does). If it loads the order without checking `order.organizationId ∈ ws.scopeOrgIds`, add that guard (`notFound()` otherwise) before rendering anything.

- [ ] **Step 2: Fetch campaign data** (frozen numbers, never cost/margin):

```ts
import { clicksByOrderLine } from "@/lib/metrics/store";
import { ctrPct } from "@/lib/reporting";
// after loading `order` with lines.include { booking: { include: { metrics, publisher, title } } }:
const clicks = await clicksByOrderLine(order.lines.map((l) => l.id));
const rows = order.lines.flatMap((l) => {
  const b = l.booking;
  if (!b) return [];
  const firstParty = b.metrics?.clicksFirstPartyAtClose ?? clicks[l.id] ?? 0;
  const impressions = b.metrics?.impressionsAtClose ?? b.metrics?.impressions ?? null;
  return [{
    publisher: b.publisher?.name ?? "—",
    title: b.title?.name ?? "—",
    liveStart: b.liveStartDate, liveEnd: b.liveEndDate,
    impressions, firstPartyClicks: firstParty,
    pageViews: b.metrics?.pageViews ?? null,
    ctr: ctrPct(firstParty, impressions),
    frozen: !!b.metrics?.frozenAt,
  }];
});
const reportedCount = rows.filter((r) => r.impressions !== null).length;
```

- [ ] **Step 3: Render the section** — a "Campaign report" block: flight window (`order.flightStartDate`/`flightEndDate`); a table of `rows` (publisher, title, live window, impressions, first-party clicks, page views, CTR); a campaign total; and the coverage caveat when `reportedCount < rows.length` (e.g. `t("ctrCoverage", { n: reportedCount, m: rows.length })`). Label frozen vs live-to-date clearly; reuse the existing reach disclaimer string. A download link to the CSV route (Task 15).

- [ ] **Step 4: Typecheck + manual verify** — confirm a buyer sees only their org's campaign, sees frozen numbers, and no cost/margin fields appear anywhere in the section.
- [ ] **Step 5: Commit** — `git commit -am "feat(campaign): advertiser campaign report section"`

### Task 15: CSV export route

**Files:**
- Create: `src/app/api/export/campaign-report/[orderId].csv/route.ts`

- [ ] **Step 1: Implement** (mirror `api/export/invoices.csv/route.ts`; gate by org scope for buyers, role for desk):

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { csv } from "@/lib/csv";
import { recordAudit } from "@/lib/audit";
import { clicksByOrderLine } from "@/lib/metrics/store";
import { ctrPct } from "@/lib/reporting";
import { getWorkspace } from "@/lib/workspace"; // use the same helper pages use for ws.scopeOrgIds

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { lines: { include: { booking: { include: { metrics: true, publisher: { select: { name: true } }, title: { select: { name: true } } } } } } },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const role = session.user.role;
  if (role !== "DESK" && role !== "SUPERADMIN") {
    const ws = await getWorkspace(session.user.id);
    if (!ws?.scopeOrgIds.includes(order.organizationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const clicks = await clicksByOrderLine(order.lines.map((l) => l.id));
  const rows = order.lines.flatMap((l) => {
    const b = l.booking; if (!b) return [];
    const firstParty = b.metrics?.clicksFirstPartyAtClose ?? clicks[l.id] ?? 0;
    const impressions = b.metrics?.impressionsAtClose ?? b.metrics?.impressions ?? null;
    return [{
      publisher: b.publisher?.name ?? "", title: b.title?.name ?? "",
      live_start: b.liveStartDate?.toISOString() ?? "", live_end: b.liveEndDate?.toISOString() ?? "",
      impressions: impressions ?? "", first_party_clicks: firstParty,
      page_views: b.metrics?.pageViews ?? "", avg_time_sec: b.metrics?.avgTimeSec ?? "",
      scroll_depth_pct: b.metrics?.scrollDepthPct ?? "", ctr_pct: ctrPct(firstParty, impressions) ?? "",
    }];
  });

  await recordAudit(session.user.id, "export.campaign_report", `Order:${orderId}`, { count: rows.length });
  return new NextResponse(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campaign-${orderId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
```

> Verify the exact `getWorkspace`/workspace helper export in `src/lib/workspace.ts` and match how `reports/page.tsx` obtains `ws`. Use the same call.

- [ ] **Step 2: Typecheck + manual verify** — desk and an in-scope buyer can download; an out-of-scope buyer gets 403.
- [ ] **Step 3: Commit** — `git commit -am "feat(campaign): campaign report CSV export"`

---

## Phase 8 — i18n

### Task 16: Translations

**Files:**
- Modify: `src/messages/en.json` (first), then `no.json`, `da.json`, `sv.json`, `fi.json`, `de.json`

- [ ] **Step 1: Add the `campaignReport` namespace** to `en.json`:

```json
"campaignReport": {
  "pageTitle": "Campaign results",
  "intro": "The campaign on {publisher} has ended — please share the performance numbers below.",
  "impressions": "Impressions",
  "pageViews": "Page views",
  "clicks": "Clicks (your count)",
  "avgTimeSec": "Avg. time on article (seconds)",
  "scrollDepthPct": "Scroll depth (%)",
  "publisherTrackingUrl": "Your tracking link (optional)",
  "submit": "Submit numbers",
  "statusNotFound": "This link is not valid.",
  "statusExpired": "This link has expired.",
  "statusResponded": "Thanks — we've already received your numbers.",
  "statusCancelled": "This request was cancelled."
}
```

- [ ] **Step 2: Add desk strings** to the `desk` and (new) `performance`/`campaignReport` desk keys referenced in Tasks 12–14 (`metricsNeedsContactTitle`, `ctrCoverage`, flight-window labels, frozen/live-to-date labels, reach disclaimer). Grep the new components for `t("…")` calls and add every key.

- [ ] **Step 3: Translate** each added key into `no/da/sv/fi/de.json` (natural native copy, not literal calques — see the translation-quality memory).

- [ ] **Step 4: Verify no missing keys** — `pnpm build` (next-intl will surface missing-message errors) or run the app and load each new page in `en` + `no`.
- [ ] **Step 5: Commit** — `git commit -am "feat(campaign): i18n for campaign reporting"`

---

## Final verification

- [ ] `pnpm typecheck` — clean
- [ ] `pnpm test` — all green (token, status, metrics-write, reporting, campaign integration)
- [ ] `pnpm lint` — clean
- [ ] `pnpm build` — succeeds (no missing i18n keys)
- [ ] Manual end-to-end on the dev server (project port): create an order with a past `flightEndDate` and ≥2 publishers → `pnpm build-metrics-campaign` → requests created (one per publisher; NEEDS_CONTACT where no contact) → `pnpm send-metrics-batch --dry-run` lists them → open a token form, submit numbers → desk order shows them with source badge → `pnpm freeze-metrics-campaigns` freezes → advertiser report shows frozen numbers + CTR + coverage caveat → CSV downloads, gated.
- [ ] Open PR from `feat/campaign-reporting`.

---

## Self-review notes (spec coverage)

- Flight dates (Order) + per-publisher live dates (booking) → Task 1. ✅
- Publisher anchor on booking → Task 1 (+ backfill) + Task 9 (creation). ✅
- `MetricsRequest` + booking join, idempotent per (order, publisher) → Task 1 + Task 7. ✅
- Three feed-in paths into per-booking metrics with precedence → form Task 11, email Task 8 (`ingestMetricsReply`), desk Task 12; precedence Task 4 + `writeBookingMetric` Task 8. ✅
- Freeze at close + live-to-date → Task 4 + `freezeDueCampaigns` Task 8 + report Task 14. ✅
- Daily scan as tsx+cron (not jobs.ts) + suppression-by-reason + token-in-reply-to → Task 7 + Task 10. ✅
- NEEDS_CONTACT surfacing → Task 7 + Task 13. ✅
- Tracking: first-party clicks (existing) + publisher tracking URL surfaced → Task 11 (capture) + Tasks 12/14 (surface). ✅
- Advertiser report (scope-gated, CTR + coverage caveat, CSV) → Tasks 14–15. ✅
- Edge guards (CONTENT_FEE-only, cancelled, multi-placement, tz grace, dup) → Tasks 3, 7, 8, 9. ✅
- i18n → Task 16. ✅

**Known follow-ups (out of scope, noted for the PR):** unify the three token modules; promote `publisherTrackingUrl` to a child table if publishers send several; windowed (dated) first-party click events; the AI extractor itself (operator-side) — this plan provides `ingestMetricsReply` as the attribution+write seam it calls.
