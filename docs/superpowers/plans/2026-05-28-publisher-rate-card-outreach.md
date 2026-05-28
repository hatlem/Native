# Publisher Rate-Card Outreach — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build sub-systems A (scraper + admin review), B (sequenced outreach campaign), and C (tokenised response page with R2 PDF upload) for the publisher rate-card outreach, per the design at `docs/superpowers/specs/2026-05-28-publisher-rate-card-outreach-design.md`.

**Architecture:** Extends the existing PriceRequest engine pattern. Adds `ContactCandidate`, `RateCardRequest`, `RateCardRequestTitle`, `OutreachSuppression` models. A generic `lib/storage/r2.ts` helper (reusable beyond this feature) handles file uploads via Cloudflare R2. Three CLI scripts (`scrape-contacts`, `build-rate-card-campaign`, `send-rate-card-batch`) drive the workflow. Admin UI at `/desk/publisher-contacts` for candidate review and campaign control. Tokenised response page at `/[locale]/rate-card/[token]`.

**Tech Stack:** Next.js 16 (App Router), Prisma + Postgres, Resend (email), Cloudflare R2 (S3-compatible blob storage via `@aws-sdk/client-s3`), cheerio (HTML parsing), `node:test` (Node built-in test runner), Tailwind + shadcn for UI.

**Testing convention:** This codebase uses Node's built-in test runner (`tsx --test`) — `import { test } from "node:test"; import assert from "node:assert/strict"`. NOT Vitest/Jest.

---

## File Structure

**New files (created):**

```
prisma/migrations/<timestamp>_publisher_outreach/migration.sql   (auto-generated)

src/lib/storage/
  r2.ts                          generic Cloudflare R2 helper (presignUpload, presignDownload)
  r2.test.ts

src/lib/outreach/
  tokens.ts                      token gen + checkRateCardRequest verdict
  tokens.test.ts
  sequence.ts                    stepKindForCount, nextStepDate (pure)
  sequence.test.ts
  scoring.ts                     confidence-scoring for scraper candidates (pure)
  scoring.test.ts
  extract.ts                     cheerio HTML -> candidate emails (pure)
  extract.test.ts
  dedup.ts                       group SalesContacts by normalised email (pure-ish)
  dedup.test.ts
  candidates.ts                  DB: approveCandidate, rejectCandidate, bulkApprove
  candidates.test.ts
  suppression.ts                 DB: addSuppression, isSuppressed
  suppression.test.ts
  email.ts                       6 locales x 3 sequence steps = 18 email builders
  email.test.ts
  campaign.ts                    DB: buildRateCardCampaign, sendRateCardStep
  campaign.test.ts
  scraper.ts                     pure orchestration: fetch+parse one publisher
  scraper.test.ts

scripts/
  scrape-publisher-contacts.ts   wires scraper.ts to DB + CLI
  build-rate-card-campaign.ts    wires campaign.buildRateCardCampaign to CLI
  send-rate-card-batch.ts        wires campaign.sendRateCardStep batch loop to CLI

src/app/[locale]/desk/publisher-contacts/
  page.tsx                       server component, lists publishers w/ candidates
  actions.ts                     approveCandidateAction, rejectCandidateAction, bulkApproveAction, sendBatchAction
  _components/
    CandidateRow.tsx             one row per publisher; expand for multi-candidates
    CampaignTab.tsx              build + send-batch controls

src/app/[locale]/rate-card/[token]/
  page.tsx                       server component, gates by checkRateCardRequest
  actions.ts                     submitRateCardAction, presignUploadAction
  thanks/page.tsx
  unsubscribe/page.tsx
  _components/
    RateCardForm.tsx             client component: file picker + per-title rates

test-fixtures/scraper/
  newspaper-annonsere.html       Nordic ad-sales page example
  saleshouse-kontakt.html        sales-house contact page example
  homepage-no-ad-link.html       homepage with only generic /kontakt
  spa-no-contacts.html           JS-rendered with no extractable email
```

**Modified files:**

```
prisma/schema.prisma             add 4 models + 2 enums + back-relation on User
src/lib/rate-limit.ts            add outreachLimiter export
package.json                     add deps: @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, cheerio + scripts
.env.example                     add OUTREACH_*, R2_* env vars
src/messages/{en,no,sv,da,fi,de}.json   add `rateCard` and `publisherContacts` namespaces
```

---

## Task 1: Dependencies, env vars, package.json scripts

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install runtime dependencies**

Run:
```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner cheerio
pnpm add -D @types/cheerio
```

Expected: `package.json` shows the four packages; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Add CLI scripts to package.json**

Edit `package.json` `"scripts"` section, add:

```json
"scrape-contacts": "tsx scripts/scrape-publisher-contacts.ts",
"build-rate-card-campaign": "tsx scripts/build-rate-card-campaign.ts",
"send-rate-card-batch": "tsx scripts/send-rate-card-batch.ts"
```

- [ ] **Step 3: Append env vars to .env.example**

Append to `.env.example`:

```bash
# --- Publisher outreach (rate-card campaign) ---
OUTREACH_DAILY_CAP=20
OUTREACH_HOURLY_CAP=8
OUTREACH_FROM="NativeSpin Partnerships <partnerships@nativespin.com>"
OUTREACH_REPLY_TO=partnerships@nativespin.com

# --- Cloudflare R2 (generic blob storage; used for rate-card PDFs and future placement images) ---
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=nativespin-blob
R2_PUBLIC_URL=
```

- [ ] **Step 4: Verify the project still builds and tests pass**

Run: `pnpm typecheck && pnpm test`
Expected: existing tests pass, no new test files yet.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "chore(outreach): add deps + env scaffolding for rate-card campaign"
```

---

## Task 2: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_publisher_outreach/migration.sql` (generated)

- [ ] **Step 1: Add ContactCandidate model + enum to schema.prisma**

In `prisma/schema.prisma`, add near `Publisher` (right after `PublisherInvite` model, around line 432):

```prisma
// Scraper output queued for admin review. Approved candidates become SalesContact rows.
model ContactCandidate {
  id             String          @id @default(cuid())
  publisherId    String
  publisher      Publisher       @relation(fields: [publisherId], references: [id], onDelete: Cascade)
  email          String
  name           String?
  role           String?
  phone          String?
  sourceUrl      String
  confidence     Int
  status         CandidateStatus @default(PENDING)
  reviewedById   String?
  reviewedAt     DateTime?
  salesContactId String?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  @@unique([publisherId, email])
  @@index([status])
}

enum CandidateStatus {
  PENDING
  APPROVED
  REJECTED
}
```

Also add back-relation on `Publisher`:

```prisma
// In `model Publisher { ... }`, alongside `sales contacts SalesContact[]`:
contactCandidates ContactCandidate[]
```

- [ ] **Step 2: Add RateCardRequest + RateCardRequestTitle + enum to schema.prisma**

In `prisma/schema.prisma`, add after the `PriceQuote`-related models (around line 830):

```prisma
// One row = one recipient = one campaign thread = one token.
// Spans potentially many titles across many publishers (sales-house case).
model RateCardRequest {
  id                String                  @id @default(cuid())
  recipientEmail    String
  recipientName     String?
  locale            String
  token             String                  @unique
  sentCount         Int                     @default(0)
  lastStepAt        DateTime?
  nextStepAt        DateTime?
  sentAt            DateTime?
  openedAt          DateTime?
  respondedAt       DateTime?
  cancelledAt       DateTime?
  expiresAt         DateTime
  mediaKitUrl       String?
  mediaKitObjectKey String?
  responseNote      String?
  formatsOffered    String[]
  contactName       String?
  contactEmail      String?
  contactRole       String?
  responseData      Json?
  responseSource    RateCardResponseSource?
  createdById       String
  createdBy         User                    @relation("RateCardRequestCreator", fields: [createdById], references: [id])
  createdAt         DateTime                @default(now())
  updatedAt         DateTime                @updatedAt
  titles            RateCardRequestTitle[]

  @@index([recipientEmail])
  @@index([nextStepAt, respondedAt, cancelledAt])
  @@index([respondedAt])
}

enum RateCardResponseSource {
  FORM
  EMAIL
}

model RateCardRequestTitle {
  rateCardRequestId String
  rateCardRequest   RateCardRequest @relation(fields: [rateCardRequestId], references: [id], onDelete: Cascade)
  titleId           String
  title             Title           @relation(fields: [titleId], references: [id], onDelete: Cascade)

  @@id([rateCardRequestId, titleId])
  @@index([titleId])
}
```

Also add back-relations:

```prisma
// In `model User { ... }`, alongside other relations:
rateCardRequests RateCardRequest[] @relation("RateCardRequestCreator")

// In `model Title { ... }`, alongside other relations:
rateCardRequests RateCardRequestTitle[]
```

- [ ] **Step 3: Add OutreachSuppression model**

In `prisma/schema.prisma`, add near the bottom (before the final closing brace if any):

```prisma
// Email suppression list — recipients who unsubscribed, bounced, or were manually excluded.
model OutreachSuppression {
  email     String   @id
  reason    String
  createdAt DateTime @default(now())
}
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm prisma migrate dev --name publisher_outreach --create-only`
Expected: a new directory under `prisma/migrations/` is created with a SQL file.

- [ ] **Step 5: Review the SQL, then apply locally**

Run: `pnpm prisma migrate dev`
Expected: migration applied, Prisma client regenerated. `pnpm typecheck` should pass.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(outreach): add ContactCandidate, RateCardRequest, OutreachSuppression models"
```

---

## Task 3: Generic R2 blob helper

**Files:**
- Create: `src/lib/storage/r2.ts`
- Create: `src/lib/storage/r2.test.ts`

The helper is intentionally generic — `prefix` parameter means rate-cards, future placement images, and any other blob need use the same helper.

- [ ] **Step 1: Write the failing test**

Create `src/lib/storage/r2.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildObjectKey, validateContentType, isAllowedSize } from "./r2";

test("buildObjectKey composes prefix/timestamp-uuid-filename", () => {
  const key = buildObjectKey({ prefix: "rate-cards", filename: "Bonnier RateCard 2026.pdf" });
  assert.match(key, /^rate-cards\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+-bonnier-ratecard-2026\.pdf$/);
});

test("buildObjectKey strips dangerous characters from filename", () => {
  const key = buildObjectKey({ prefix: "p", filename: "../../etc/passwd" });
  assert.ok(!key.includes(".."));
  assert.match(key, /etc-passwd$/);
});

test("validateContentType allows known media-kit types", () => {
  assert.ok(validateContentType("application/pdf"));
  assert.ok(validateContentType("application/vnd.openxmlformats-officedocument.presentationml.presentation"));
  assert.ok(validateContentType("image/png"));
  assert.ok(validateContentType("image/jpeg"));
});

test("validateContentType rejects executables and scripts", () => {
  assert.ok(!validateContentType("application/x-msdownload"));
  assert.ok(!validateContentType("text/html"));
  assert.ok(!validateContentType("application/javascript"));
});

test("isAllowedSize enforces 25 MB cap", () => {
  assert.ok(isAllowedSize(1));
  assert.ok(isAllowedSize(25 * 1024 * 1024));
  assert.ok(!isAllowedSize(25 * 1024 * 1024 + 1));
  assert.ok(!isAllowedSize(0));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/storage/r2.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement r2.ts**

Create `src/lib/storage/r2.ts`:

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "image/png",
  "image/jpeg",
]);
const MAX_BYTES = 25 * 1024 * 1024;

export function validateContentType(ct: string): boolean {
  return ALLOWED_TYPES.has(ct.toLowerCase());
}

export function isAllowedSize(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_BYTES;
}

export function buildObjectKey(args: { prefix: string; filename: string }): string {
  const date = new Date().toISOString().slice(0, 10);
  const uuid = randomUUID();
  const safe = args.filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.+/g, ".")          // collapse multiple dots (drops .. traversal)
    .replace(/^[-.]+|[-.]+$/g, "");  // trim leading/trailing -.
  return `${args.prefix}/${date}/${uuid}-${safe}`;
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) throw new Error("R2_ACCOUNT_ID not set");
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

function bucket(): string {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error("R2_BUCKET not set");
  return b;
}

export async function presignUpload(args: {
  prefix: string;
  filename: string;
  contentType: string;
  ttlSec?: number;
}): Promise<{ url: string; key: string }> {
  if (!validateContentType(args.contentType)) {
    throw new Error(`content_type_not_allowed:${args.contentType}`);
  }
  const key = buildObjectKey({ prefix: args.prefix, filename: args.filename });
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: args.contentType,
  });
  const url = await getSignedUrl(client(), cmd, { expiresIn: args.ttlSec ?? 300 });
  return { url, key };
}

export async function presignDownload(args: { key: string; ttlSec?: number }): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: args.key });
  return getSignedUrl(client(), cmd, { expiresIn: args.ttlSec ?? 3600 });
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test src/lib/storage/r2.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/r2.ts src/lib/storage/r2.test.ts
git commit -m "feat(storage): generic Cloudflare R2 helper with presign + content-type guards"
```

---

## Task 4: Outreach tokens

**Files:**
- Create: `src/lib/outreach/tokens.ts`
- Create: `src/lib/outreach/tokens.test.ts`

Mirrors `lib/pricing/tokens.ts` but for `RateCardRequest`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/outreach/tokens.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newRateCardToken,
  rateCardExpiryFromNow,
  checkRateCardRequest,
  rateCardLink,
} from "./tokens";

test("newRateCardToken yields ~32 url-safe chars, unique per call", () => {
  const a = newRateCardToken();
  const b = newRateCardToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length >= 30 && a.length <= 34);
});

test("rateCardExpiryFromNow defaults to 30 days from given now", () => {
  const now = new Date("2026-05-01T00:00:00Z");
  const exp = rateCardExpiryFromNow(30, now);
  assert.equal(exp.toISOString(), "2026-05-31T00:00:00.000Z");
});

test("checkRateCardRequest returns null for missing request", () => {
  assert.equal(checkRateCardRequest(null), null);
  assert.equal(checkRateCardRequest(undefined), null);
});

test("checkRateCardRequest reports cancelled, responded, expired in that order", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const future = new Date("2026-07-01T00:00:00Z");
  const past = new Date("2026-05-01T00:00:00Z");
  assert.deepEqual(
    checkRateCardRequest({ expiresAt: future, respondedAt: null, cancelledAt: now }, now),
    { ok: false, reason: "cancelled" },
  );
  assert.deepEqual(
    checkRateCardRequest({ expiresAt: future, respondedAt: now, cancelledAt: null }, now),
    { ok: false, reason: "responded" },
  );
  assert.deepEqual(
    checkRateCardRequest({ expiresAt: past, respondedAt: null, cancelledAt: null }, now),
    { ok: false, reason: "expired" },
  );
});

test("checkRateCardRequest returns ok when active", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const future = new Date("2026-07-01T00:00:00Z");
  assert.deepEqual(
    checkRateCardRequest({ expiresAt: future, respondedAt: null, cancelledAt: null }, now),
    { ok: true },
  );
});

test("rateCardLink encodes the token + locale", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://nativespin.com";
  assert.equal(
    rateCardLink("abc-123", "no"),
    "https://nativespin.com/no/rate-card/abc-123",
  );
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm test src/lib/outreach/tokens.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement tokens.ts**

Create `src/lib/outreach/tokens.ts`:

```ts
import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 24;
export const DEFAULT_RATE_CARD_TTL_DAYS = 30;

export function newRateCardToken(): string {
  return randomBytes(TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function rateCardExpiryFromNow(
  days: number = DEFAULT_RATE_CARD_TTL_DAYS,
  now: Date = new Date(),
): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export type RateCardRequestShape = {
  expiresAt: Date;
  respondedAt: Date | null;
  cancelledAt: Date | null;
};

export type RateCardVerdict =
  | { ok: true }
  | { ok: false; reason: "expired" | "responded" | "cancelled" };

export function checkRateCardRequest(
  req: RateCardRequestShape | null | undefined,
  now: Date = new Date(),
): RateCardVerdict | null {
  if (!req) return null;
  if (req.cancelledAt) return { ok: false, reason: "cancelled" };
  if (req.respondedAt) return { ok: false, reason: "responded" };
  if (req.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

export function rateCardLink(token: string, locale: string = "en"): string {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
  return `${origin}/${locale}/rate-card/${encodeURIComponent(token)}`;
}

export function unsubscribeLink(token: string, locale: string = "en"): string {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
  return `${origin}/${locale}/rate-card/${encodeURIComponent(token)}/unsubscribe`;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test src/lib/outreach/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreach/tokens.ts src/lib/outreach/tokens.test.ts
git commit -m "feat(outreach): token gen + verdict for RateCardRequest"
```

---

## Task 5: Outreach sequence logic

**Files:**
- Create: `src/lib/outreach/sequence.ts`
- Create: `src/lib/outreach/sequence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/outreach/sequence.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stepKindForCount,
  nextStepDate,
  isSequenceTerminal,
  MAX_STEPS,
} from "./sequence";

test("stepKindForCount maps 0/1/2 to initial/bump1/bump2", () => {
  assert.equal(stepKindForCount(0), "initial");
  assert.equal(stepKindForCount(1), "bump1");
  assert.equal(stepKindForCount(2), "bump2");
});

test("stepKindForCount throws past max", () => {
  assert.throws(() => stepKindForCount(3), /max_steps_exceeded/);
});

test("nextStepDate(initial) is 5 days out", () => {
  const now = new Date("2026-05-01T00:00:00Z");
  const next = nextStepDate("initial", now);
  assert.equal(next?.toISOString(), "2026-05-06T00:00:00.000Z");
});

test("nextStepDate(bump1) is 7 days out", () => {
  const now = new Date("2026-05-06T00:00:00Z");
  const next = nextStepDate("bump1", now);
  assert.equal(next?.toISOString(), "2026-05-13T00:00:00.000Z");
});

test("nextStepDate(bump2) is null — sequence terminates", () => {
  assert.equal(nextStepDate("bump2"), null);
});

test("isSequenceTerminal is true at MAX_STEPS or beyond", () => {
  assert.equal(isSequenceTerminal(2), false);
  assert.equal(isSequenceTerminal(3), true);
  assert.equal(MAX_STEPS, 3);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test src/lib/outreach/sequence.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement sequence.ts**

Create `src/lib/outreach/sequence.ts`:

```ts
export type SequenceStep = "initial" | "bump1" | "bump2";
export const MAX_STEPS = 3;

const DAYS_AFTER: Record<SequenceStep, number | null> = {
  initial: 5,
  bump1: 7,
  bump2: null, // terminal
};

export function stepKindForCount(sentCount: number): SequenceStep {
  if (sentCount === 0) return "initial";
  if (sentCount === 1) return "bump1";
  if (sentCount === 2) return "bump2";
  throw new Error("max_steps_exceeded");
}

export function nextStepDate(currentStep: SequenceStep, now: Date = new Date()): Date | null {
  const days = DAYS_AFTER[currentStep];
  if (days === null) return null;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function isSequenceTerminal(sentCount: number): boolean {
  return sentCount >= MAX_STEPS;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test src/lib/outreach/sequence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreach/sequence.ts src/lib/outreach/sequence.test.ts
git commit -m "feat(outreach): 3-step sequence (initial -> bump1 +5d -> bump2 +7d)"
```

---

## Task 6: Confidence scoring (pure)

**Files:**
- Create: `src/lib/outreach/scoring.ts`
- Create: `src/lib/outreach/scoring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/outreach/scoring.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate, type CandidateHints } from "./scoring";

function hints(overrides: Partial<CandidateHints>): CandidateHints {
  return {
    isMailto: false,
    pathKind: "other",
    contextHasSalesVocab: false,
    hasName: false,
    emailDomainMatchesPublisher: false,
    ...overrides,
  };
}

test("baseline (no signals) is 0", () => {
  assert.equal(scoreCandidate(hints({})), 0);
});

test("strong: mailto + sales page + sales vocab + name + matching domain = 100 (capped)", () => {
  assert.equal(
    scoreCandidate(
      hints({
        isMailto: true,
        pathKind: "sales",
        contextHasSalesVocab: true,
        hasName: true,
        emailDomainMatchesPublisher: true,
      }),
    ),
    100, // 50+30+20+20+10 = 130, clamped to 100
  );
});

test("medium: scraped-text email on /kontakt with name = 20", () => {
  assert.equal(scoreCandidate(hints({ pathKind: "contact", hasName: true })), 20);
});

test("mailto alone is 50", () => {
  assert.equal(scoreCandidate(hints({ isMailto: true })), 50);
});

test("sales-vocab without mailto or sales path is 20", () => {
  assert.equal(scoreCandidate(hints({ contextHasSalesVocab: true })), 20);
});

test("score never below 0", () => {
  assert.equal(scoreCandidate(hints({})), 0);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test src/lib/outreach/scoring.test.ts`

- [ ] **Step 3: Implement scoring.ts**

Create `src/lib/outreach/scoring.ts`:

```ts
export type CandidateHints = {
  isMailto: boolean;
  pathKind: "sales" | "contact" | "homepage" | "other";
  contextHasSalesVocab: boolean;
  hasName: boolean;
  emailDomainMatchesPublisher: boolean;
};

export function scoreCandidate(h: CandidateHints): number {
  let score = 0;
  if (h.isMailto) score += 50;
  if (h.pathKind === "sales") score += 30;
  if (h.contextHasSalesVocab) score += 20;
  if (h.hasName) score += 20;
  if (h.emailDomainMatchesPublisher) score += 10;
  return Math.max(0, Math.min(100, score));
}

export const SALES_VOCAB_RE = /(annonse|annonsering|annonsor|advert|sales|werben|werbung|mainos|mainonta)/i;
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test src/lib/outreach/scoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreach/scoring.ts src/lib/outreach/scoring.test.ts
git commit -m "feat(outreach): candidate confidence scoring + sales vocab regex"
```

---

## Task 7: HTML email extraction (pure)

**Files:**
- Create: `src/lib/outreach/extract.ts`
- Create: `src/lib/outreach/extract.test.ts`
- Create: `test-fixtures/scraper/newspaper-annonsere.html`
- Create: `test-fixtures/scraper/saleshouse-kontakt.html`
- Create: `test-fixtures/scraper/homepage-no-ad-link.html`

- [ ] **Step 1: Create test fixtures**

Create `test-fixtures/scraper/newspaper-annonsere.html`:

```html
<!doctype html>
<html lang="no">
<head><title>Annonsere — Avis</title></head>
<body>
<h1>Annonsere hos oss</h1>
<p>Ta kontakt med vår annonseavdeling for spørsmål om kampanjer:</p>
<dl>
  <dt>Salgssjef Ola Nordmann</dt>
  <dd>E-post: <a href="mailto:ola.nordmann@avis.no">ola.nordmann@avis.no</a></dd>
  <dd>Telefon: +47 99 88 77 66</dd>
</dl>
<p>Generelle henvendelser: <a href="mailto:annonse@avis.no">annonse@avis.no</a></p>
</body>
</html>
```

Create `test-fixtures/scraper/saleshouse-kontakt.html`:

```html
<!doctype html>
<html lang="no">
<head><title>Kontakt — Salgshus</title></head>
<body>
<h1>Kontakt oss</h1>
<table>
  <tr><th>Sales Director</th><td>Kari Hansen</td><td>kari@saleshouse.no</td></tr>
  <tr><th>Customer Service</th><td>—</td><td>post@saleshouse.no</td></tr>
</table>
</body>
</html>
```

Create `test-fixtures/scraper/homepage-no-ad-link.html`:

```html
<!doctype html>
<html lang="no">
<head><title>Forside</title></head>
<body>
<header><a href="/abonnement">Abonnement</a> <a href="/kontakt">Kontakt</a></header>
<p>Velkommen.</p>
</body>
</html>
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/outreach/extract.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractCandidates } from "./extract";

const FIXTURES = join(process.cwd(), "test-fixtures", "scraper");
function load(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

test("extracts mailto + role + name from a Norwegian ad-sales page", () => {
  const html = load("newspaper-annonsere.html");
  const got = extractCandidates({
    html,
    sourceUrl: "https://www.avis.no/annonsere",
    pathKind: "sales",
    publisherDomain: "avis.no",
  });
  assert.equal(got.length, 2);
  // primary: ola.nordmann
  assert.equal(got[0].email, "ola.nordmann@avis.no");
  assert.equal(got[0].hints.isMailto, true);
  assert.equal(got[0].hints.pathKind, "sales");
  assert.equal(got[0].hints.hasName, true);
  assert.equal(got[0].hints.emailDomainMatchesPublisher, true);
  assert.equal(got[0].name, "Salgssjef Ola Nordmann");
  // secondary: annonse@avis.no — generic role inbox
  assert.equal(got[1].email, "annonse@avis.no");
});

test("extracts emails from a /kontakt page with table layout", () => {
  const html = load("saleshouse-kontakt.html");
  const got = extractCandidates({
    html,
    sourceUrl: "https://saleshouse.no/kontakt",
    pathKind: "contact",
    publisherDomain: "saleshouse.no",
  });
  const emails = got.map((c) => c.email).sort();
  assert.deepEqual(emails, ["kari@saleshouse.no", "post@saleshouse.no"]);
});

test("returns no candidates from a homepage without emails", () => {
  const html = load("homepage-no-ad-link.html");
  const got = extractCandidates({
    html,
    sourceUrl: "https://www.example.no/",
    pathKind: "homepage",
    publisherDomain: "example.no",
  });
  assert.equal(got.length, 0);
});

test("deduplicates the same email found multiple times on a page", () => {
  const html = `<a href="mailto:x@y.com">x</a> ... contact <a href="mailto:x@y.com">again</a>`;
  const got = extractCandidates({
    html,
    sourceUrl: "https://y.com/c",
    pathKind: "contact",
    publisherDomain: "y.com",
  });
  assert.equal(got.length, 1);
  assert.equal(got[0].email, "x@y.com");
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm test src/lib/outreach/extract.test.ts`

- [ ] **Step 4: Implement extract.ts**

Create `src/lib/outreach/extract.ts`:

```ts
import * as cheerio from "cheerio";
import { SALES_VOCAB_RE, type CandidateHints } from "./scoring";

export type ExtractedCandidate = {
  email: string;
  name: string | null;
  role: string | null;
  phone: string | null;
  hints: CandidateHints;
};

export type ExtractArgs = {
  html: string;
  sourceUrl: string;
  pathKind: CandidateHints["pathKind"];
  publisherDomain: string;
};

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/;

export function extractCandidates(args: ExtractArgs): ExtractedCandidate[] {
  const $ = cheerio.load(args.html);
  const found = new Map<string, ExtractedCandidate>();

  // Pass 1: mailto: links (highest signal)
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const email = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) return;
    EMAIL_RE.lastIndex = 0; // RE has /g flag
    const { name, role } = inferNameAndRole($, el);
    const surroundingText = $(el).closest("p, li, dd, dt, td, tr, section, div").first().text();
    const hints: CandidateHints = {
      isMailto: true,
      pathKind: args.pathKind,
      contextHasSalesVocab: SALES_VOCAB_RE.test(surroundingText),
      hasName: !!name,
      emailDomainMatchesPublisher: email.endsWith("@" + args.publisherDomain),
    };
    found.set(email, {
      email,
      name,
      role,
      phone: extractNearbyPhone($, el),
      hints,
    });
  });

  // Pass 2: scrape plain-text emails within sales-vocab nodes only.
  $("p, li, dd, dt, td, tr, address").each((_, el) => {
    const text = $(el).text();
    if (!SALES_VOCAB_RE.test(text)) return;
    const matches = text.match(EMAIL_RE);
    if (!matches) return;
    for (const raw of matches) {
      const email = raw.toLowerCase();
      if (found.has(email)) continue;
      const { name, role } = inferNameAndRole($, el);
      const hints: CandidateHints = {
        isMailto: false,
        pathKind: args.pathKind,
        contextHasSalesVocab: true,
        hasName: !!name,
        emailDomainMatchesPublisher: email.endsWith("@" + args.publisherDomain),
      };
      found.set(email, {
        email,
        name,
        role,
        phone: extractNearbyPhone($, el),
        hints,
      });
    }
  });

  return Array.from(found.values());
}

function inferNameAndRole($: cheerio.CheerioAPI, el: any): { name: string | null; role: string | null } {
  // <dt>Salgssjef Ola Nordmann</dt><dd>email</dd>
  const $el = $(el);
  const dt = $el.closest("dd").prevAll("dt").first();
  if (dt.length) {
    const txt = dt.text().trim();
    return splitRoleAndName(txt);
  }
  // <tr><th>Sales Director</th><td>Kari Hansen</td><td>email</td></tr>
  const tr = $el.closest("tr");
  if (tr.length) {
    const cells = tr.find("th, td").map((_, c) => $(c).text().trim()).get();
    if (cells.length >= 3) return { role: cells[0] || null, name: cells[1] || null };
  }
  // Fallback: nearest preceding <h*>
  const heading = $el.parentsUntil("body").find("h1, h2, h3, h4, h5, h6").last();
  if (heading.length) {
    return splitRoleAndName(heading.text().trim());
  }
  return { name: null, role: null };
}

function splitRoleAndName(s: string): { name: string | null; role: string | null } {
  // "Salgssjef Ola Nordmann" -> role + name
  if (!s) return { name: null, role: null };
  // No reliable separator in Nordic — keep the whole string in `name` field, downstream UI lets admin correct it.
  // (We could parse out a known role-vocab prefix, but heuristics get noisy.)
  return { name: s, role: null };
}

function extractNearbyPhone($: cheerio.CheerioAPI, el: any): string | null {
  const txt = $(el).closest("dd, li, p, tr, address").text();
  const m = txt.match(PHONE_RE);
  return m ? m[0].trim() : null;
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test src/lib/outreach/extract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/outreach/extract.ts src/lib/outreach/extract.test.ts test-fixtures/scraper
git commit -m "feat(outreach): cheerio-based email/name/role extraction with fixtures"
```

---

## Task 8: Scraper orchestration (pure, no DB)

**Files:**
- Create: `src/lib/outreach/scraper.ts`
- Create: `src/lib/outreach/scraper.test.ts`

Pulls together: URL probing, fetch, extract, scoring. DB-free so it's unit-testable with a stub fetcher.

- [ ] **Step 1: Write the failing test**

Create `src/lib/outreach/scraper.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathsForCountry, scrapePublisher } from "./scraper";

test("pathsForCountry returns locale-specific ad-sales paths", () => {
  assert.deepEqual(
    pathsForCountry("NO").slice(0, 4),
    ["/", "/annonsere", "/annonsorer", "/annonsering"],
  );
  assert.ok(pathsForCountry("DE").includes("/werben"));
  assert.ok(pathsForCountry("FI").includes("/mainosta"));
  assert.ok(pathsForCountry("UK").includes("/advertise"));
});

const FIXTURES = join(process.cwd(), "test-fixtures", "scraper");

test("scrapePublisher aggregates candidates across probed paths and scores them", async () => {
  const annonsere = readFileSync(join(FIXTURES, "newspaper-annonsere.html"), "utf8");
  const home = readFileSync(join(FIXTURES, "homepage-no-ad-link.html"), "utf8");
  const fetcher = async (url: string) => {
    if (url.endsWith("/annonsere")) return { ok: true, status: 200, text: annonsere, contentType: "text/html" };
    return { ok: true, status: 200, text: home, contentType: "text/html" };
  };
  const result = await scrapePublisher({
    publisherId: "pub1",
    rootUrl: "https://www.avis.no",
    countryCode: "NO",
    fetcher,
  });
  assert.ok(result.candidates.length >= 1);
  const top = result.candidates[0];
  assert.equal(top.email, "ola.nordmann@avis.no");
  assert.ok(top.confidence >= 90);
  assert.equal(result.errors.length, 0);
});

test("scrapePublisher tolerates 404s and continues other paths", async () => {
  const annonsere = readFileSync(join(FIXTURES, "newspaper-annonsere.html"), "utf8");
  const fetcher = async (url: string) => {
    if (url.endsWith("/annonsere")) return { ok: true, status: 200, text: annonsere, contentType: "text/html" };
    return { ok: false, status: 404, text: "", contentType: "text/html" };
  };
  const result = await scrapePublisher({
    publisherId: "pub1",
    rootUrl: "https://www.avis.no",
    countryCode: "NO",
    fetcher,
  });
  assert.ok(result.candidates.length >= 1);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test src/lib/outreach/scraper.test.ts`

- [ ] **Step 3: Implement scraper.ts**

Create `src/lib/outreach/scraper.ts`:

```ts
import { extractCandidates } from "./extract";
import { scoreCandidate, type CandidateHints } from "./scoring";

export type FetchResponse = {
  ok: boolean;
  status: number;
  text: string;
  contentType: string;
};
export type Fetcher = (url: string) => Promise<FetchResponse>;

export type ScrapedCandidate = {
  email: string;
  name: string | null;
  role: string | null;
  phone: string | null;
  sourceUrl: string;
  confidence: number;
  hints: CandidateHints;
};

export type ScrapeResult = {
  publisherId: string;
  candidates: ScrapedCandidate[];
  errors: Array<{ url: string; reason: string }>;
};

const PATHS_BY_COUNTRY: Record<string, string[]> = {
  NO: ["/", "/annonsere", "/annonsorer", "/annonsering", "/kontakt", "/om-oss"],
  SE: ["/", "/annonsera", "/annonsorer", "/annonsering", "/kontakt", "/om-oss"],
  DK: ["/", "/annoncere", "/annoncorer", "/kontakt", "/om-os"],
  FI: ["/", "/mainosta", "/mainonta", "/yhteystiedot", "/yhteys"],
  DE: ["/", "/werben", "/anzeigen", "/kontakt", "/impressum"],
  AT: ["/", "/werben", "/kontakt", "/impressum"],
  CH: ["/", "/werben", "/kontakt", "/impressum"],
  UK: ["/", "/advertise", "/advertising", "/contact", "/contact-us"],
  IE: ["/", "/advertise", "/advertising", "/contact", "/contact-us"],
};

export function pathsForCountry(country: string): string[] {
  return PATHS_BY_COUNTRY[country] ?? PATHS_BY_COUNTRY["UK"];
}

function pathKindFor(path: string): CandidateHints["pathKind"] {
  if (path === "/") return "homepage";
  if (/annons|advert|werben|anzeigen|mainos/i.test(path)) return "sales";
  if (/kontakt|contact|impressum|yhteys/i.test(path)) return "contact";
  return "other";
}

export async function scrapePublisher(args: {
  publisherId: string;
  rootUrl: string;
  countryCode: string;
  fetcher: Fetcher;
}): Promise<ScrapeResult> {
  const root = args.rootUrl.replace(/\/+$/, "");
  const publisherDomain = new URL(root).hostname.replace(/^www\./, "");
  const seen = new Map<string, ScrapedCandidate>();
  const errors: ScrapeResult["errors"] = [];

  for (const path of pathsForCountry(args.countryCode)) {
    const url = root + path;
    let res: FetchResponse;
    try {
      res = await args.fetcher(url);
    } catch (err) {
      errors.push({ url, reason: `fetch_throw:${(err as Error).message}` });
      continue;
    }
    if (!res.ok) {
      errors.push({ url, reason: `http_${res.status}` });
      continue;
    }
    if (!res.contentType.toLowerCase().includes("html")) {
      errors.push({ url, reason: `non_html:${res.contentType}` });
      continue;
    }

    const pathKind = pathKindFor(path);
    const extracted = extractCandidates({
      html: res.text,
      sourceUrl: url,
      pathKind,
      publisherDomain,
    });
    for (const c of extracted) {
      const score = scoreCandidate(c.hints);
      const existing = seen.get(c.email);
      if (!existing || existing.confidence < score) {
        seen.set(c.email, {
          email: c.email,
          name: c.name,
          role: c.role,
          phone: c.phone,
          sourceUrl: url,
          confidence: score,
          hints: c.hints,
        });
      }
    }
  }

  const candidates = Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
  return { publisherId: args.publisherId, candidates, errors };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test src/lib/outreach/scraper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreach/scraper.ts src/lib/outreach/scraper.test.ts
git commit -m "feat(outreach): publisher scraper orchestration with per-country path probing"
```

---

## Task 9: SalesContact dedup by email

**Files:**
- Create: `src/lib/outreach/dedup.ts`
- Create: `src/lib/outreach/dedup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/outreach/dedup.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSalesContactsByEmail, normaliseEmail } from "./dedup";

test("normaliseEmail lowercases and trims", () => {
  assert.equal(normaliseEmail("  Annonse@Bonnier.NO  "), "annonse@bonnier.no");
});

test("groups three contacts with the same email into one recipient", () => {
  const contacts = [
    { id: "sc1", publisherId: "p1", email: "annonse@bonnier.no", name: "Annonseteam", titleIds: ["t1", "t2"] },
    { id: "sc2", publisherId: "p2", email: "ANNONSE@bonnier.no", name: null, titleIds: ["t3"] },
    { id: "sc3", publisherId: "p3", email: "annonse@bonnier.no ", name: "Bonnier Sales", titleIds: ["t4", "t5"] },
  ];
  const groups = groupSalesContactsByEmail(contacts);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].recipientEmail, "annonse@bonnier.no");
  assert.deepEqual(groups[0].titleIds.sort(), ["t1", "t2", "t3", "t4", "t5"]);
  // Picks the longest non-null name
  assert.equal(groups[0].recipientName, "Bonnier Sales");
  assert.deepEqual(groups[0].sourceContactIds.sort(), ["sc1", "sc2", "sc3"]);
});

test("two distinct emails => two groups", () => {
  const contacts = [
    { id: "a", publisherId: "p1", email: "x@a.no", name: null, titleIds: ["t1"] },
    { id: "b", publisherId: "p2", email: "y@b.no", name: null, titleIds: ["t2"] },
  ];
  const groups = groupSalesContactsByEmail(contacts);
  assert.equal(groups.length, 2);
});

test("excludes suppressed emails", () => {
  const contacts = [
    { id: "a", publisherId: "p1", email: "good@a.no", name: null, titleIds: ["t1"] },
    { id: "b", publisherId: "p2", email: "bad@b.no", name: null, titleIds: ["t2"] },
  ];
  const groups = groupSalesContactsByEmail(contacts, new Set(["bad@b.no"]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].recipientEmail, "good@a.no");
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test src/lib/outreach/dedup.test.ts`

- [ ] **Step 3: Implement dedup.ts**

Create `src/lib/outreach/dedup.ts`:

```ts
export function normaliseEmail(s: string): string {
  return s.trim().toLowerCase();
}

export type ContactInput = {
  id: string;
  publisherId: string;
  email: string;
  name: string | null;
  titleIds: string[];
};

export type RecipientGroup = {
  recipientEmail: string;
  recipientName: string | null;
  titleIds: string[];           // deduped union across the group
  sourceContactIds: string[];
};

export function groupSalesContactsByEmail(
  contacts: ContactInput[],
  suppressed: Set<string> = new Set(),
): RecipientGroup[] {
  const byEmail = new Map<string, RecipientGroup>();
  for (const c of contacts) {
    const email = normaliseEmail(c.email);
    if (suppressed.has(email)) continue;
    let group = byEmail.get(email);
    if (!group) {
      group = {
        recipientEmail: email,
        recipientName: c.name,
        titleIds: [],
        sourceContactIds: [],
      };
      byEmail.set(email, group);
    }
    // Pick the longest non-null name.
    if (c.name && (!group.recipientName || c.name.length > group.recipientName.length)) {
      group.recipientName = c.name;
    }
    group.sourceContactIds.push(c.id);
    for (const t of c.titleIds) {
      if (!group.titleIds.includes(t)) group.titleIds.push(t);
    }
  }
  return Array.from(byEmail.values());
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test src/lib/outreach/dedup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreach/dedup.ts src/lib/outreach/dedup.test.ts
git commit -m "feat(outreach): dedup SalesContacts by normalised email (sales-house consolidation)"
```

---

## Task 10: Suppression list DB ops

**Files:**
- Create: `src/lib/outreach/suppression.ts`
- Create: `src/lib/outreach/suppression.test.ts` (integration test — talks to test DB)

- [ ] **Step 1: Write the failing test**

Create `src/lib/outreach/suppression.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { addSuppression, isSuppressed, suppressedEmailSet } from "./suppression";

const TEST_EMAILS = ["sup1@example.com", "sup2@example.com"];

before(async () => {
  await prisma.outreachSuppression.deleteMany({ where: { email: { in: TEST_EMAILS } } });
});
after(async () => {
  await prisma.outreachSuppression.deleteMany({ where: { email: { in: TEST_EMAILS } } });
});

test("addSuppression upserts (idempotent) and isSuppressed reflects it", async () => {
  await addSuppression({ email: "  SUP1@Example.COM  ", reason: "unsubscribe" });
  assert.equal(await isSuppressed("sup1@example.com"), true);
  // Re-add — must not throw and must keep first reason
  await addSuppression({ email: "sup1@example.com", reason: "bounce" });
  const row = await prisma.outreachSuppression.findUnique({ where: { email: "sup1@example.com" } });
  assert.equal(row?.reason, "unsubscribe");
});

test("suppressedEmailSet returns the normalised email set", async () => {
  await addSuppression({ email: "sup2@example.com", reason: "manual" });
  const set = await suppressedEmailSet();
  assert.ok(set.has("sup1@example.com"));
  assert.ok(set.has("sup2@example.com"));
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test src/lib/outreach/suppression.test.ts`

- [ ] **Step 3: Implement suppression.ts**

Create `src/lib/outreach/suppression.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { normaliseEmail } from "./dedup";

export async function addSuppression(args: { email: string; reason: string }): Promise<void> {
  const email = normaliseEmail(args.email);
  await prisma.outreachSuppression.upsert({
    where: { email },
    update: {}, // first-reason-wins is intentional; we don't want a bounce to overwrite a user's unsubscribe
    create: { email, reason: args.reason },
  });
}

export async function isSuppressed(email: string): Promise<boolean> {
  const row = await prisma.outreachSuppression.findUnique({
    where: { email: normaliseEmail(email) },
  });
  return !!row;
}

export async function suppressedEmailSet(): Promise<Set<string>> {
  const rows = await prisma.outreachSuppression.findMany({ select: { email: true } });
  return new Set(rows.map((r) => r.email));
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test src/lib/outreach/suppression.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreach/suppression.ts src/lib/outreach/suppression.test.ts
git commit -m "feat(outreach): suppression list with idempotent first-reason-wins upsert"
```

---

## Task 11: Candidate review DB ops (approve / reject / bulk-approve)

**Files:**
- Create: `src/lib/outreach/candidates.ts`
- Create: `src/lib/outreach/candidates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/outreach/candidates.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { approveCandidate, rejectCandidate, bulkApproveAboveConfidence } from "./candidates";

let publisherId: string;
let userId: string;
let titleId: string;
let candidateId: string;

before(async () => {
  // Use any existing market + reviewing user (created in the project seed)
  const market = await prisma.market.findFirstOrThrow();
  const user = await prisma.user.findFirstOrThrow({ where: { role: { in: ["DESK", "SUPERADMIN"] } } });
  userId = user.id;
  const pub = await prisma.publisher.create({
    data: { name: "Test Publisher (outreach)", countryCode: market.code, marketId: market.id },
  });
  publisherId = pub.id;
  const title = await prisma.title.create({
    data: {
      name: "Test Title (outreach)",
      slug: `test-title-outreach-${Date.now()}`,
      publisherId,
      countryCode: market.code,
      marketId: market.id,
      type: "Avis",
      category: "general-news",
    },
  });
  titleId = title.id;
  const cand = await prisma.contactCandidate.create({
    data: {
      publisherId,
      email: "approve-me@test.no",
      name: "Test Person",
      role: "Salgssjef",
      sourceUrl: "https://test.no/annonsere",
      confidence: 90,
    },
  });
  candidateId = cand.id;
});

after(async () => {
  await prisma.contactCandidate.deleteMany({ where: { publisherId } });
  await prisma.salesContactTitle.deleteMany({ where: { title: { publisherId } } });
  await prisma.salesContact.deleteMany({ where: { publisherId } });
  await prisma.title.deleteMany({ where: { publisherId } });
  await prisma.publisher.delete({ where: { id: publisherId } });
});

test("approveCandidate creates SalesContact + attaches all publisher's titles + marks approved", async () => {
  const result = await approveCandidate({ candidateId, reviewedById: userId });
  assert.ok(result.salesContactId);

  const sc = await prisma.salesContact.findUniqueOrThrow({ where: { id: result.salesContactId } });
  assert.equal(sc.email, "approve-me@test.no");
  assert.equal(sc.publisherId, publisherId);

  const linked = await prisma.salesContactTitle.findMany({ where: { salesContactId: sc.id } });
  assert.equal(linked.length, 1);
  assert.equal(linked[0].titleId, titleId);
  assert.equal(linked[0].isPrimary, true);

  const cand = await prisma.contactCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  assert.equal(cand.status, "APPROVED");
  assert.equal(cand.salesContactId, sc.id);
});

test("rejectCandidate sets status REJECTED + records reviewer", async () => {
  const cand = await prisma.contactCandidate.create({
    data: { publisherId, email: "reject@test.no", sourceUrl: "x", confidence: 10 },
  });
  await rejectCandidate({ candidateId: cand.id, reviewedById: userId, reason: "garbage" });
  const after = await prisma.contactCandidate.findUniqueOrThrow({ where: { id: cand.id } });
  assert.equal(after.status, "REJECTED");
  assert.equal(after.reviewedById, userId);
});

test("bulkApproveAboveConfidence approves all PENDING with confidence >= threshold", async () => {
  await prisma.contactCandidate.create({
    data: { publisherId, email: "low@test.no", sourceUrl: "x", confidence: 30 },
  });
  await prisma.contactCandidate.create({
    data: { publisherId, email: "high@test.no", sourceUrl: "x", confidence: 95 },
  });
  const result = await bulkApproveAboveConfidence({ minConfidence: 80, reviewedById: userId });
  assert.ok(result.approved >= 1);

  const high = await prisma.contactCandidate.findFirstOrThrow({ where: { publisherId, email: "high@test.no" } });
  assert.equal(high.status, "APPROVED");
  const low = await prisma.contactCandidate.findFirstOrThrow({ where: { publisherId, email: "low@test.no" } });
  assert.equal(low.status, "PENDING");
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test src/lib/outreach/candidates.test.ts`

- [ ] **Step 3: Implement candidates.ts**

Create `src/lib/outreach/candidates.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { recordAudit } from "@/lib/audit";

export async function approveCandidate(args: {
  candidateId: string;
  reviewedById: string;
  overrides?: { name?: string; email?: string; role?: string; phone?: string };
}): Promise<{ salesContactId: string }> {
  const cand = await prisma.contactCandidate.findUniqueOrThrow({
    where: { id: args.candidateId },
    include: { publisher: { include: { titles: { select: { id: true } } } } },
  });

  const data = {
    publisherId: cand.publisherId,
    email: args.overrides?.email ?? cand.email,
    name: args.overrides?.name ?? cand.name ?? "Sales",
    role: args.overrides?.role ?? cand.role ?? undefined,
    phone: args.overrides?.phone ?? cand.phone ?? undefined,
  };

  const sc = await createSalesContact(data);

  // Attach to every title under this publisher, mark first as primary.
  const titles = cand.publisher.titles;
  for (let i = 0; i < titles.length; i++) {
    await attachContactToTitle({
      salesContactId: sc.id,
      titleId: titles[i].id,
      isPrimary: i === 0,
    });
  }

  await prisma.contactCandidate.update({
    where: { id: cand.id },
    data: {
      status: "APPROVED",
      reviewedById: args.reviewedById,
      reviewedAt: new Date(),
      salesContactId: sc.id,
    },
  });
  await recordAudit(args.reviewedById, "candidate.approve", `ContactCandidate:${cand.id}`, {
    salesContactId: sc.id,
    titleCount: titles.length,
  });

  return { salesContactId: sc.id };
}

export async function rejectCandidate(args: {
  candidateId: string;
  reviewedById: string;
  reason?: string;
}): Promise<void> {
  await prisma.contactCandidate.update({
    where: { id: args.candidateId },
    data: { status: "REJECTED", reviewedById: args.reviewedById, reviewedAt: new Date() },
  });
  await recordAudit(args.reviewedById, "candidate.reject", `ContactCandidate:${args.candidateId}`, {
    reason: args.reason ?? null,
  });
}

export async function bulkApproveAboveConfidence(args: {
  minConfidence: number;
  reviewedById: string;
}): Promise<{ approved: number; failed: number }> {
  const candidates = await prisma.contactCandidate.findMany({
    where: { status: "PENDING", confidence: { gte: args.minConfidence } },
    select: { id: true },
  });
  let approved = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await approveCandidate({ candidateId: c.id, reviewedById: args.reviewedById });
      approved++;
    } catch {
      failed++;
    }
  }
  return { approved, failed };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test src/lib/outreach/candidates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreach/candidates.ts src/lib/outreach/candidates.test.ts
git commit -m "feat(outreach): approve/reject/bulk-approve candidates -> SalesContact"
```

---

## Task 12: Outreach email templates (6 locales × 3 steps)

**Files:**
- Create: `src/lib/outreach/email.ts`
- Create: `src/lib/outreach/email.test.ts`

This file is intentionally template-heavy. Keep templates side-by-side so consistency is visible.

- [ ] **Step 1: Write the failing test**

Create `src/lib/outreach/email.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOutreachEmail, localeForMarketCode } from "./email";

const titles = [
  { name: "Aftenposten", marketCode: "NO" as const },
  { name: "Bergens Tidende", marketCode: "NO" as const },
  { name: "Adresseavisen", marketCode: "NO" as const },
];

test("localeForMarketCode covers all 9 markets", () => {
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

test("initial NO email contains hook + title list + link + unsubscribe", () => {
  const built = buildOutreachEmail({
    step: "initial",
    locale: "no",
    recipientName: "Annonseteam",
    titles,
    link: "https://nativespin.com/no/rate-card/abc",
    unsubscribeLink: "https://nativespin.com/no/rate-card/abc/unsubscribe",
  });
  assert.match(built.subject, /native|rate card/i);
  assert.match(built.text, /annonsører som leter/);
  assert.match(built.text, /Aftenposten/);
  assert.match(built.text, /Bergens Tidende/);
  assert.match(built.text, /https:\/\/nativespin\.com\/no\/rate-card\/abc/);
  assert.match(built.text, /Avregistrer/);
});

test("bump1 is short, references the previous mail, contains link", () => {
  const built = buildOutreachEmail({
    step: "bump1",
    locale: "no",
    recipientName: "Kari",
    titles,
    link: "https://x.test",
    unsubscribeLink: "https://x.test/u",
  });
  assert.match(built.subject, /^Re:/i);
  assert.ok(built.text.length < 800, "bump should be short");
});

test("bump2 is breakaway with point-to-right-person ask", () => {
  const built = buildOutreachEmail({
    step: "bump2",
    locale: "no",
    recipientName: null,
    titles,
    link: "https://x.test",
    unsubscribeLink: "https://x.test/u",
  });
  assert.match(built.text, /riktig kontakt|peke oss/i);
});

test("falls back to English when locale template missing", () => {
  const built = buildOutreachEmail({
    step: "initial",
    locale: "fr" as any, // unknown locale
    recipientName: null,
    titles,
    link: "https://x.test",
    unsubscribeLink: "https://x.test/u",
  });
  assert.match(built.subject, /Native|rate card/i);
});

test("renders 'and N more' when title list > 8", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `Title ${i + 1}`, marketCode: "NO" as const }));
  const built = buildOutreachEmail({
    step: "initial",
    locale: "no",
    recipientName: null,
    titles: many,
    link: "https://x.test",
    unsubscribeLink: "https://x.test/u",
  });
  assert.match(built.text, /og \d+ til/);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test src/lib/outreach/email.test.ts`

- [ ] **Step 3: Implement email.ts**

Create `src/lib/outreach/email.ts`:

```ts
import type { MarketCode } from "@prisma/client";
import type { SequenceStep } from "./sequence";

export type Locale = "en" | "no" | "sv" | "da" | "fi" | "de";

export function localeForMarketCode(code: MarketCode): Locale {
  switch (code) {
    case "NO": return "no";
    case "SE": return "sv";
    case "DK": return "da";
    case "FI": return "fi";
    case "DE":
    case "AT":
    case "CH": return "de";
    case "UK":
    case "IE": return "en";
  }
}

export type TitleRef = { name: string; marketCode: MarketCode };

export type BuildArgs = {
  step: SequenceStep;
  locale: Locale;
  recipientName: string | null;
  titles: TitleRef[];
  link: string;
  unsubscribeLink: string;
};

export type Built = { subject: string; text: string };

const MAX_TITLES_INLINE = 8;

function titleLines(titles: TitleRef[], moreLine: (n: number) => string): string {
  const shown = titles.slice(0, MAX_TITLES_INLINE);
  const lines = shown.map((t) => `  • ${t.name} (${t.marketCode})`);
  const extra = titles.length - shown.length;
  if (extra > 0) lines.push(`  ${moreLine(extra)}`);
  return lines.join("\n");
}

// ---------- Norwegian ----------
function no_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  const subject = `Native-rate cards for ${a.titles.length} av deres titler — buyer-pipeline i NativeSpin`;
  const text = [
    greeting,
    ``,
    `Vi har annonsører som leter etter native- og annonsørinnhold-inventar på tvers av Norden, DACH og UK/IE.`,
    `For å være klar når en konkret henvendelse kommer, trenger vi oppdaterte rate cards for følgende formater:`,
    ``,
    `  • Native artikkel / annonsørinnhold`,
    `  • Sponset innhold`,
    `  • Brand stories`,
    `  • Video native`,
    `  • Andre formater dere tilbyr`,
    ``,
    `Titler dette gjelder:`,
    titleLines(a.titles, (n) => `…og ${n} til — se full liste på lenken`),
    ``,
    `Send oss rate cards (lenken er gyldig i 30 dager):`,
    a.link,
    ``,
    `Hvis dette ikke er riktig kontakt, gjerne videresend internt — eller gi oss beskjed via lenken.`,
    ``,
    `— NativeSpin`,
    ``,
    `Avregistrer fra videre kommunikasjon: ${a.unsubscribeLink}`,
  ].join("\n");
  return { subject, text };
}
function no_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Re: Native-rate cards for ${a.titles.length} titler`,
    text: [
      greeting,
      ``,
      `Bare et kort kakk på døra i tilfelle den forrige e-posten ble begravet.`,
      `Vi venter fortsatt på rate cards for ${a.titles.length} titler — lenken er fortsatt aktiv:`,
      ``,
      a.link,
      ``,
      `— NativeSpin`,
      ``,
      `Avregistrer: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function no_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Riktig kontakt for rate cards?`,
    text: [
      greeting,
      ``,
      `Vi har prøvd å nå rette kontakt for rate cards på ${a.titles.length} titler i NativeSpin-katalogen.`,
      `Hvis det ikke er deg, kan du peke oss til hvem som er?`,
      ``,
      a.link,
      ``,
      `Hvis dere ikke er interessert i å være listet for native i NativeSpin, gi gjerne beskjed her: ${a.unsubscribeLink} — så stopper vi videre kontakt.`,
      ``,
      `— NativeSpin`,
    ].join("\n"),
  };
}

// ---------- Swedish ----------
function sv_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Native-rate cards för ${a.titles.length} av era titlar — buyer-pipeline hos NativeSpin`,
    text: [
      greeting,
      ``,
      `Vi har annonsörer som söker native- och annonsörsinnehåll-inventarier över Norden, DACH och UK/IE.`,
      `För att vara redo när en konkret förfrågan kommer behöver vi aktuella rate cards för följande format:`,
      ``,
      `  • Native artikel / annonsörsinnehåll`,
      `  • Sponsrat innehåll`,
      `  • Brand stories`,
      `  • Video native`,
      `  • Andra format ni erbjuder`,
      ``,
      `Berörda titlar:`,
      titleLines(a.titles, (n) => `…och ${n} till — se hela listan på länken`),
      ``,
      `Skicka rate cards (länken gäller i 30 dagar):`,
      a.link,
      ``,
      `Om detta inte är rätt kontakt: vidarebefordra gärna internt eller hör av er via länken.`,
      ``,
      `— NativeSpin`,
      ``,
      `Avregistrera: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function sv_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Re: Native-rate cards för ${a.titles.length} titlar`,
    text: [greeting, ``, `Snabb påminnelse om förra mejlet — vi väntar fortfarande på rate cards för ${a.titles.length} titlar:`, ``, a.link, ``, `— NativeSpin`, ``, `Avregistrera: ${a.unsubscribeLink}`].join("\n"),
  };
}
function sv_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Rätt kontakt för rate cards?`,
    text: [
      greeting, ``,
      `Vi har försökt nå rätt kontakt för rate cards på ${a.titles.length} titlar i NativeSpin-katalogen. Om det inte är du, kan du peka oss vidare?`,
      ``, a.link, ``,
      `Vill ni inte vara med? Avregistrera här: ${a.unsubscribeLink}.`,
      ``, `— NativeSpin`,
    ].join("\n"),
  };
}

// ---------- Danish ----------
function da_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Native-rate cards for ${a.titles.length} af jeres titler — buyer-pipeline i NativeSpin`,
    text: [
      greeting, ``,
      `Vi har annoncører, der leder efter native- og annoncørindhold-inventar på tværs af Norden, DACH og UK/IE.`,
      `For at være klar når en konkret henvendelse kommer, har vi brug for aktuelle rate cards for følgende formater:`,
      ``,
      `  • Native artikel / annoncørindhold`,
      `  • Sponsoreret indhold`,
      `  • Brand stories`,
      `  • Video native`,
      `  • Andre formater I tilbyder`,
      ``,
      `Berørte titler:`,
      titleLines(a.titles, (n) => `…og ${n} mere — se hele listen på linket`),
      ``,
      `Send os rate cards (linket gælder i 30 dage):`,
      a.link, ``,
      `Hvis dette ikke er rette kontakt, så send det gerne videre internt — eller giv os besked via linket.`,
      ``, `— NativeSpin`, ``,
      `Afmeld: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function da_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return { subject: `Re: Native-rate cards for ${a.titles.length} titler`, text: [greeting, ``, `Lille reminder — vi venter stadig på rate cards for ${a.titles.length} titler:`, ``, a.link, ``, `— NativeSpin`, ``, `Afmeld: ${a.unsubscribeLink}`].join("\n") };
}
function da_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return { subject: `Rette kontakt for rate cards?`, text: [greeting, ``, `Vi har forsøgt at nå rette kontakt for rate cards på ${a.titles.length} titler. Hvis det ikke er dig, kan du henvise os til den rette?`, ``, a.link, ``, `Hvis I ikke er interesserede, så afmeld her: ${a.unsubscribeLink}.`, ``, `— NativeSpin`].join("\n") };
}

// ---------- Finnish ----------
function fi_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Natiivimainonnan hintatiedot ${a.titles.length} julkaisullenne — NativeSpin buyer-pipeline`,
    text: [
      greeting, ``,
      `Meillä on mainostajia, jotka etsivät natiivi- ja mainostajasisältöinventaaria Pohjoismaissa, DACH-alueella ja UK/IE:ssa.`,
      `Jotta voimme olla valmiina kun konkreettinen kysely tulee, tarvitsemme ajantasaiset hinnastot seuraaville formaateille:`,
      ``,
      `  • Natiiviartikkeli / mainostajasisältö`,
      `  • Sponsoroitu sisältö`,
      `  • Brand stories`,
      `  • Video native`,
      `  • Muut tarjoamanne formaatit`,
      ``,
      `Kyseiset julkaisut:`,
      titleLines(a.titles, (n) => `…ja ${n} muuta — koko lista linkin takana`),
      ``,
      `Lähetä hinnastot (linkki on voimassa 30 päivää):`,
      a.link, ``,
      `Jos tämä ei ole oikea yhteyshenkilö, välitäthän sisäisesti — tai kerro meille linkin kautta.`,
      ``, `— NativeSpin`, ``,
      `Peruuta tilaus: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function fi_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return { subject: `Re: Hinnastot ${a.titles.length} julkaisulle`, text: [greeting, ``, `Pieni muistutus — odotamme yhä hinnastoja ${a.titles.length} julkaisulle:`, ``, a.link, ``, `— NativeSpin`, ``, `Peruuta: ${a.unsubscribeLink}`].join("\n") };
}
function fi_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return { subject: `Oikea yhteyshenkilö hinnastoille?`, text: [greeting, ``, `Olemme yrittäneet tavoittaa oikeaa yhteyshenkilöä hinnastoille ${a.titles.length} julkaisussa. Jos se ei ole sinä, voitko ohjata meidät eteenpäin?`, ``, a.link, ``, `Jos ette ole kiinnostuneita, peruuta tilaus: ${a.unsubscribeLink}.`, ``, `— NativeSpin`].join("\n") };
}

// ---------- German ----------
function de_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hallo ${a.recipientName},` : `Hallo,`;
  return {
    subject: `Native-Rate-Cards für ${a.titles.length} Ihrer Titel — Buyer-Pipeline bei NativeSpin`,
    text: [
      greeting, ``,
      `Wir haben Werbetreibende, die Native- und Advertorial-Inventar in den Nordics, DACH und UK/IE suchen.`,
      `Um bereit zu sein, wenn eine konkrete Anfrage kommt, brauchen wir aktuelle Rate-Cards für folgende Formate:`,
      ``,
      `  • Native-Artikel / Advertorial`,
      `  • Sponsored Content`,
      `  • Brand Stories`,
      `  • Video-Native`,
      `  • Weitere Formate, die Sie anbieten`,
      ``,
      `Betroffene Titel:`,
      titleLines(a.titles, (n) => `…und ${n} weitere — vollständige Liste über den Link`),
      ``,
      `Rate-Cards senden (Link 30 Tage gültig):`,
      a.link, ``,
      `Falls Sie nicht die richtige Kontaktperson sind, leiten Sie diese E-Mail bitte intern weiter — oder geben Sie uns über den Link Bescheid.`,
      ``, `— NativeSpin`, ``,
      `Abmelden: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function de_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hallo ${a.recipientName},` : `Hallo,`;
  return { subject: `Re: Native-Rate-Cards für ${a.titles.length} Titel`, text: [greeting, ``, `Kurze Erinnerung — wir warten weiterhin auf Rate-Cards für ${a.titles.length} Titel:`, ``, a.link, ``, `— NativeSpin`, ``, `Abmelden: ${a.unsubscribeLink}`].join("\n") };
}
function de_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hallo ${a.recipientName},` : `Hallo,`;
  return { subject: `Richtige Kontaktperson für Rate-Cards?`, text: [greeting, ``, `Wir versuchen, den richtigen Ansprechpartner für Rate-Cards von ${a.titles.length} Titeln im NativeSpin-Katalog zu erreichen. Falls Sie nicht zuständig sind, können Sie uns weiterleiten?`, ``, a.link, ``, `Falls Sie kein Interesse haben, hier abmelden: ${a.unsubscribeLink}.`, ``, `— NativeSpin`].join("\n") };
}

// ---------- English ----------
function en_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hi ${a.recipientName},` : `Hi,`;
  return {
    subject: `Native rate cards for ${a.titles.length} of your titles — NativeSpin buyer-pipeline`,
    text: [
      greeting, ``,
      `We have advertisers looking for native and advertorial inventory across the Nordics, DACH, and UK/IE.`,
      `To be ready when a concrete brief lands, we need current rate cards for the following formats:`,
      ``,
      `  • Native article / advertorial`,
      `  • Sponsored content`,
      `  • Brand stories`,
      `  • Native video`,
      `  • Other formats you offer`,
      ``,
      `Titles involved:`,
      titleLines(a.titles, (n) => `…and ${n} more — see the full list at the link`),
      ``,
      `Send us rate cards (link valid for 30 days):`,
      a.link, ``,
      `If you're not the right contact, please forward internally — or let us know via the link.`,
      ``, `— NativeSpin`, ``,
      `Unsubscribe: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function en_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hi ${a.recipientName},` : `Hi,`;
  return { subject: `Re: Rate cards for ${a.titles.length} titles`, text: [greeting, ``, `Quick nudge in case the last email got buried — we're still waiting on rate cards for ${a.titles.length} titles:`, ``, a.link, ``, `— NativeSpin`, ``, `Unsubscribe: ${a.unsubscribeLink}`].join("\n") };
}
function en_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hi ${a.recipientName},` : `Hi,`;
  return { subject: `Right contact for rate cards?`, text: [greeting, ``, `We've been trying to reach the right contact for rate cards on ${a.titles.length} titles in the NativeSpin catalog. If it's not you, can you point us to who is?`, ``, a.link, ``, `Not interested? Unsubscribe here: ${a.unsubscribeLink}.`, ``, `— NativeSpin`].join("\n") };
}

const BUILDERS: Record<Locale, Record<SequenceStep, (a: BuildArgs) => Built>> = {
  no: { initial: no_initial, bump1: no_bump1, bump2: no_bump2 },
  sv: { initial: sv_initial, bump1: sv_bump1, bump2: sv_bump2 },
  da: { initial: da_initial, bump1: da_bump1, bump2: da_bump2 },
  fi: { initial: fi_initial, bump1: fi_bump1, bump2: fi_bump2 },
  de: { initial: de_initial, bump1: de_bump1, bump2: de_bump2 },
  en: { initial: en_initial, bump1: en_bump1, bump2: en_bump2 },
};

export function buildOutreachEmail(a: BuildArgs): Built {
  const locale = (BUILDERS as Record<string, unknown>)[a.locale] ? a.locale : ("en" as Locale);
  return BUILDERS[locale][a.step](a);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test src/lib/outreach/email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreach/email.ts src/lib/outreach/email.test.ts
git commit -m "feat(outreach): 6-locale × 3-step email templates with buyer-pipeline hook"
```

---

## Task 13: Rate limiter — add outreachLimiter

**Files:**
- Modify: `src/lib/rate-limit.ts`

- [ ] **Step 1: Add the new limiter**

Edit `src/lib/rate-limit.ts`, append near the existing `rfqLimiter` (around line 112):

```ts
// Outreach campaign sending. Bucket per-process — the CLI batch
// honours the same limiter as the desk-UI "Send" button so concurrent
// runs can't exceed our daily/hourly caps. Defaults to ~8/hour which
// is the Gmail/Yahoo "casual sender" sweet spot during domain warmup.
export const outreachLimiter = new RateLimiter(8, 8 / 3600);
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rate-limit.ts
git commit -m "feat(rate-limit): outreachLimiter for rate-card-request campaign throttling"
```

---

## Task 14: Campaign — build phase

**Files:**
- Create: `src/lib/outreach/campaign.ts` (build phase only; send phase added in Task 15)
- Create: `src/lib/outreach/campaign.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/outreach/campaign.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { buildRateCardCampaign } from "./campaign";

let userId: string;
let publisherIds: string[] = [];
let titleIds: string[] = [];
let salesContactIds: string[] = [];

before(async () => {
  const market = await prisma.market.findFirstOrThrow();
  const user = await prisma.user.findFirstOrThrow({ where: { role: { in: ["DESK", "SUPERADMIN"] } } });
  userId = user.id;

  // Two publishers share the same sales-house email; a third has a unique one.
  for (let i = 0; i < 3; i++) {
    const pub = await prisma.publisher.create({
      data: { name: `Outreach Pub ${i}-${Date.now()}`, countryCode: market.code, marketId: market.id },
    });
    publisherIds.push(pub.id);
    const title = await prisma.title.create({
      data: {
        name: `Outreach Title ${i}-${Date.now()}`,
        slug: `outreach-title-${i}-${Date.now()}`,
        publisherId: pub.id,
        countryCode: market.code,
        marketId: market.id,
        type: "Avis",
        category: "general-news",
      },
    });
    titleIds.push(title.id);
    const email = i < 2 ? `shared@saleshouse-test.example` : `solo@publisher-test.example`;
    const sc = await prisma.salesContact.create({
      data: { publisherId: pub.id, email, name: `Contact ${i}` },
    });
    salesContactIds.push(sc.id);
    await prisma.salesContactTitle.create({
      data: { salesContactId: sc.id, titleId: title.id, isPrimary: true },
    });
  }
});

after(async () => {
  await prisma.rateCardRequestTitle.deleteMany({ where: { titleId: { in: titleIds } } });
  await prisma.rateCardRequest.deleteMany({ where: { recipientEmail: { in: ["shared@saleshouse-test.example", "solo@publisher-test.example"] } } });
  await prisma.salesContactTitle.deleteMany({ where: { titleId: { in: titleIds } } });
  await prisma.salesContact.deleteMany({ where: { id: { in: salesContactIds } } });
  await prisma.title.deleteMany({ where: { id: { in: titleIds } } });
  await prisma.publisher.deleteMany({ where: { id: { in: publisherIds } } });
});

test("buildRateCardCampaign groups 2 contacts sharing email -> 1 request with both titles", async () => {
  const result = await buildRateCardCampaign({ createdById: userId, scopeContactIds: salesContactIds });
  assert.equal(result.requests_created, 2);

  const shared = await prisma.rateCardRequest.findFirstOrThrow({
    where: { recipientEmail: "shared@saleshouse-test.example" },
    include: { titles: true },
  });
  assert.equal(shared.titles.length, 2);
  assert.equal(shared.sentCount, 0);
  assert.equal(shared.locale.length, 2);

  const solo = await prisma.rateCardRequest.findFirstOrThrow({
    where: { recipientEmail: "solo@publisher-test.example" },
    include: { titles: true },
  });
  assert.equal(solo.titles.length, 1);
});

test("buildRateCardCampaign is idempotent — second run creates 0 new requests", async () => {
  const result = await buildRateCardCampaign({ createdById: userId, scopeContactIds: salesContactIds });
  assert.equal(result.requests_created, 0);
});

test("buildRateCardCampaign skips suppressed emails", async () => {
  await prisma.outreachSuppression.upsert({
    where: { email: "solo@publisher-test.example" },
    update: {},
    create: { email: "solo@publisher-test.example", reason: "unsubscribe" },
  });
  await prisma.rateCardRequest.deleteMany({ where: { recipientEmail: "solo@publisher-test.example" } });

  const result = await buildRateCardCampaign({ createdById: userId, scopeContactIds: salesContactIds });
  // shared@ already exists; solo@ is suppressed
  assert.equal(result.requests_created, 0);
  const solo = await prisma.rateCardRequest.findFirst({ where: { recipientEmail: "solo@publisher-test.example" } });
  assert.equal(solo, null);

  // Cleanup
  await prisma.outreachSuppression.delete({ where: { email: "solo@publisher-test.example" } });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test src/lib/outreach/campaign.test.ts`

- [ ] **Step 3: Implement campaign.ts (build phase only)**

Create `src/lib/outreach/campaign.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { newRateCardToken, rateCardExpiryFromNow } from "./tokens";
import { groupSalesContactsByEmail, normaliseEmail } from "./dedup";
import { suppressedEmailSet } from "./suppression";
import { localeForMarketCode, type Locale } from "./email";

export async function buildRateCardCampaign(args: {
  createdById: string;
  scopeContactIds?: string[]; // when omitted, builds for ALL SalesContacts
}): Promise<{ requests_created: number; requests_skipped: number; titles_covered: number }> {
  const contacts = await prisma.salesContact.findMany({
    where: args.scopeContactIds ? { id: { in: args.scopeContactIds } } : undefined,
    include: { titles: { include: { title: { select: { id: true, market: { select: { code: true } } } } } } },
  });

  const suppressed = await suppressedEmailSet();
  const groups = groupSalesContactsByEmail(
    contacts.map((c) => ({
      id: c.id,
      publisherId: c.publisherId,
      email: c.email,
      name: c.name ?? null,
      titleIds: c.titles.map((t) => t.titleId),
    })),
    suppressed,
  );

  let created = 0;
  let skipped = 0;
  let titlesCovered = 0;

  for (const g of groups) {
    // Skip if an active (non-cancelled, non-expired) request already exists for this email.
    const existing = await prisma.rateCardRequest.findFirst({
      where: {
        recipientEmail: g.recipientEmail,
        cancelledAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (existing) {
      skipped++;
      continue;
    }

    // Compute dominant locale from titles' markets
    const localeCount = new Map<Locale, number>();
    for (const c of contacts.filter((c) => g.sourceContactIds.includes(c.id))) {
      for (const t of c.titles) {
        const loc = localeForMarketCode(t.title.market.code);
        localeCount.set(loc, (localeCount.get(loc) ?? 0) + 1);
      }
    }
    const locale = [...localeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "en";

    const req = await prisma.rateCardRequest.create({
      data: {
        recipientEmail: g.recipientEmail,
        recipientName: g.recipientName,
        locale,
        token: newRateCardToken(),
        expiresAt: rateCardExpiryFromNow(),
        createdById: args.createdById,
        titles: {
          create: g.titleIds.map((titleId) => ({ titleId })),
        },
      },
    });
    created++;
    titlesCovered += g.titleIds.length;
    await recordAudit(args.createdById, "rate_card_request.create", `RateCardRequest:${req.id}`, {
      recipient: g.recipientEmail,
      titleCount: g.titleIds.length,
    });
  }

  return { requests_created: created, requests_skipped: skipped, titles_covered: titlesCovered };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test src/lib/outreach/campaign.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreach/campaign.ts src/lib/outreach/campaign.test.ts
git commit -m "feat(outreach): campaign build phase — group SalesContacts by email into RateCardRequests"
```

---

## Task 15: Campaign — send phase + sequence batch

**Files:**
- Modify: `src/lib/outreach/campaign.ts` (append send/batch)
- Modify: `src/lib/outreach/campaign.test.ts` (append tests)

- [ ] **Step 1: Write the failing test (append to existing campaign.test.ts)**

Append to `src/lib/outreach/campaign.test.ts`:

```ts
import { sendRateCardStep, selectBatchForSend } from "./campaign";
import { setEmailAdapter } from "@/lib/notify";

test("sendRateCardStep happy path sends initial, bumps sentCount, sets nextStepAt", async () => {
  // Replace email adapter with a capture
  const captured: Array<{ to: string; subject: string; text: string; headers?: Record<string, string> }> = [];
  setEmailAdapter(async (m) => { captured.push(m as any); });

  const req = await prisma.rateCardRequest.findFirstOrThrow({ where: { recipientEmail: "shared@saleshouse-test.example" } });
  const result = await sendRateCardStep({ requestId: req.id, actorId: userId });
  assert.deepEqual(result, { sent: "initial" });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].to, "shared@saleshouse-test.example");
  assert.ok(captured[0].headers?.["List-Unsubscribe"]);

  const after = await prisma.rateCardRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(after.sentCount, 1);
  assert.ok(after.nextStepAt);
  assert.ok(after.sentAt);
});

test("sendRateCardStep skips when respondedAt is set", async () => {
  const req = await prisma.rateCardRequest.findFirstOrThrow({ where: { recipientEmail: "shared@saleshouse-test.example" } });
  await prisma.rateCardRequest.update({ where: { id: req.id }, data: { respondedAt: new Date() } });
  const result = await sendRateCardStep({ requestId: req.id, actorId: userId });
  assert.deepEqual(result, { skipped: "responded" });
  await prisma.rateCardRequest.update({ where: { id: req.id }, data: { respondedAt: null } });
});

test("sendRateCardStep skips when recipient is suppressed", async () => {
  await prisma.outreachSuppression.upsert({
    where: { email: "shared@saleshouse-test.example" },
    update: {},
    create: { email: "shared@saleshouse-test.example", reason: "manual" },
  });
  const req = await prisma.rateCardRequest.findFirstOrThrow({ where: { recipientEmail: "shared@saleshouse-test.example" } });
  const result = await sendRateCardStep({ requestId: req.id, actorId: userId });
  assert.deepEqual(result, { skipped: "suppressed" });
  await prisma.outreachSuppression.delete({ where: { email: "shared@saleshouse-test.example" } });
});

test("selectBatchForSend returns requests due (nextStepAt <= now) and never-sent ones", async () => {
  // shared@ has been sent once already with future nextStepAt; should not appear
  const list = await selectBatchForSend({ limit: 100 });
  // We can't assert exactly which IDs (other devs' data may be present), but we can assert all returned have valid shape
  for (const r of list) {
    assert.ok(r.id);
    assert.equal(r.respondedAt, null);
    assert.equal(r.cancelledAt, null);
    assert.ok(r.expiresAt > new Date());
    assert.ok(r.sentCount < 3);
  }
});
```

- [ ] **Step 2: Run, verify fail (the new helpers don't exist yet)**

Run: `pnpm test src/lib/outreach/campaign.test.ts`

- [ ] **Step 3: Append to campaign.ts**

Append to `src/lib/outreach/campaign.ts`:

```ts
import { emailAdapter } from "@/lib/notify";
import { stepKindForCount, nextStepDate, MAX_STEPS } from "./sequence";
import { buildOutreachEmail } from "./email";
import { rateCardLink, unsubscribeLink } from "./tokens";
import { outreachLimiter } from "@/lib/rate-limit";
import { isSuppressed } from "./suppression";

export async function sendRateCardStep(args: {
  requestId: string;
  actorId: string;
}): Promise<{ sent: "initial" | "bump1" | "bump2" } | { skipped: "responded" | "cancelled" | "expired" | "suppressed" | "rate_limited" | "max_steps" }> {
  const req = await prisma.rateCardRequest.findUnique({
    where: { id: args.requestId },
    include: {
      titles: { include: { title: { include: { market: { select: { code: true } } } } } },
    },
  });
  if (!req) throw new Error("rate_card_request.not_found");
  if (req.respondedAt) return { skipped: "responded" };
  if (req.cancelledAt) return { skipped: "cancelled" };
  if (req.expiresAt <= new Date()) return { skipped: "expired" };
  if (req.sentCount >= MAX_STEPS) return { skipped: "max_steps" };

  if (await isSuppressed(req.recipientEmail)) {
    await recordAudit(args.actorId, "outreach.skipped_suppressed", `RateCardRequest:${req.id}`, {
      to: req.recipientEmail,
    });
    return { skipped: "suppressed" };
  }

  const limited = await outreachLimiter.check(`outreach-send`);
  if (!limited.ok) return { skipped: "rate_limited" };

  const step = stepKindForCount(req.sentCount);
  const link = rateCardLink(req.token, req.locale);
  const unsubLink = unsubscribeLink(req.token, req.locale);
  const built = buildOutreachEmail({
    step,
    locale: req.locale as any,
    recipientName: req.recipientName,
    titles: req.titles.map((t) => ({ name: t.title.name, marketCode: t.title.market.code })),
    link,
    unsubscribeLink: unsubLink,
  });

  await emailAdapter({
    to: req.recipientEmail,
    subject: built.subject,
    text: built.text,
    replyTo: process.env.OUTREACH_REPLY_TO,
    headers: {
      "List-Unsubscribe": `<${unsubLink}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  } as any);

  const now = new Date();
  const next = nextStepDate(step, now);
  await prisma.rateCardRequest.update({
    where: { id: req.id },
    data: {
      sentCount: req.sentCount + 1,
      lastStepAt: now,
      nextStepAt: next,
      sentAt: req.sentAt ?? now,
    },
  });

  await recordAudit(args.actorId, `rate_card_request.send.${step}`, `RateCardRequest:${req.id}`, {
    to: req.recipientEmail,
  });
  return { sent: step };
}

export async function selectBatchForSend(args: { limit: number; minConfidence?: number }) {
  const now = new Date();
  return prisma.rateCardRequest.findMany({
    where: {
      respondedAt: null,
      cancelledAt: null,
      expiresAt: { gt: now },
      sentCount: { lt: MAX_STEPS },
      OR: [
        { sentCount: 0 },
        { nextStepAt: { lte: now } },
      ],
    },
    orderBy: [{ nextStepAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: args.limit,
  });
}

export async function markRateCardOpened(token: string): Promise<void> {
  const req = await prisma.rateCardRequest.findUnique({ where: { token }, select: { id: true, openedAt: true } });
  if (!req || req.openedAt) return;
  await prisma.rateCardRequest.update({ where: { id: req.id }, data: { openedAt: new Date() } });
}

export async function findRateCardRequestByToken(token: string) {
  return prisma.rateCardRequest.findUnique({
    where: { token },
    include: {
      titles: { include: { title: { include: { publisher: true, market: true } } } },
    },
  });
}

export async function cancelRateCardRequest(args: { requestId: string; actorId: string }): Promise<void> {
  await prisma.rateCardRequest.update({ where: { id: args.requestId }, data: { cancelledAt: new Date() } });
  await recordAudit(args.actorId, "rate_card_request.cancel", `RateCardRequest:${args.requestId}`);
}
```

- [ ] **Step 4: Wire up the Resend adapter at boot (if not already)**

Check `src/lib/mail/index.ts` (or wherever the email adapter is initialised). If `makeResendAdapter` is not called yet, ensure it's called once on app boot:

```ts
import { makeResendAdapter } from "./resend";
import { setEmailAdapter } from "../notify";

const adapter = makeResendAdapter();
if (adapter) setEmailAdapter(adapter);
```

If a boot file like `src/lib/mail/index.ts` doesn't exist, create it and import it once from `src/auth.ts` or `src/app/layout.tsx` to ensure it runs.

Run: `grep -rn "makeResendAdapter" src/` to confirm it's wired. If not, add the wiring and commit separately.

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm test src/lib/outreach/campaign.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 6: Commit**

```bash
git add src/lib/outreach/campaign.ts src/lib/outreach/campaign.test.ts src/lib/mail
git commit -m "feat(outreach): campaign send phase + batch selection + open tracking"
```

---

## Task 16: Scraper CLI script

**Files:**
- Create: `scripts/scrape-publisher-contacts.ts`

- [ ] **Step 1: Implement the script**

Create `scripts/scrape-publisher-contacts.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Walks all Publishers without an APPROVED ContactCandidate, picks a
 * representative URL from one of their titles, probes locale-specific
 * paths, extracts candidate emails, scores them, and upserts into
 * ContactCandidate (PENDING) for admin review.
 *
 * Run: pnpm scrape-contacts
 *
 * Safe to rerun — @@unique([publisherId, email]) prevents duplicates.
 */
import { prisma } from "@/lib/prisma";
import { scrapePublisher, type Fetcher } from "@/lib/outreach/scraper";

const PER_HOST_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 5000;
const lastFetchByHost = new Map<string, number>();

const fetcher: Fetcher = async (url: string) => {
  const host = new URL(url).hostname;
  const last = lastFetchByHost.get(host);
  if (last) {
    const wait = PER_HOST_DELAY_MS - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  lastFetchByHost.set(host, Date.now());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "NativeSpinPublisherDiscovery/1.0 (+https://nativespin.com/partnerships-bot)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text,
      contentType: res.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timer);
  }
};

async function main() {
  const publishers = await prisma.publisher.findMany({
    where: {
      contactCandidates: {
        none: { status: "APPROVED" },
      },
    },
    include: {
      titles: {
        select: { websiteUrl: true },
        where: { websiteUrl: { not: null } },
        take: 1,
      },
    },
  });

  console.log(`[scrape] ${publishers.length} publishers without approved candidate`);
  let scraped = 0;
  let noUrl = 0;
  let errors = 0;
  let candidatesInserted = 0;

  for (let i = 0; i < publishers.length; i++) {
    const pub = publishers[i];
    const url = pub.titles[0]?.websiteUrl;
    if (!url) {
      noUrl++;
      console.log(`[${i + 1}/${publishers.length}] ${pub.name} — no URL`);
      continue;
    }
    const root = url.replace(/\/+[^/]*$/, "").replace(/^(https?:\/\/[^/]+).*$/, "$1");
    try {
      const result = await scrapePublisher({
        publisherId: pub.id,
        rootUrl: root,
        countryCode: pub.countryCode,
        fetcher,
      });
      const top = result.candidates[0];
      console.log(
        `[${i + 1}/${publishers.length}] ${new URL(root).hostname} — ${result.candidates.length} candidates${top ? ` (best: ${top.confidence})` : ""}`,
      );
      for (const c of result.candidates) {
        await prisma.contactCandidate.upsert({
          where: { publisherId_email: { publisherId: pub.id, email: c.email } },
          update: { confidence: c.confidence, sourceUrl: c.sourceUrl, name: c.name, role: c.role, phone: c.phone },
          create: {
            publisherId: pub.id,
            email: c.email,
            name: c.name,
            role: c.role,
            phone: c.phone,
            sourceUrl: c.sourceUrl,
            confidence: c.confidence,
          },
        });
        candidatesInserted++;
      }
      scraped++;
    } catch (err) {
      errors++;
      console.error(`[${i + 1}/${publishers.length}] ${pub.name} — ERROR ${(err as Error).message}`);
    }
  }

  console.log(`\n[scrape] done. scraped=${scraped} no_url=${noUrl} errors=${errors} candidates_upserted=${candidatesInserted}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-run against a small dataset**

Test only against 2-3 publishers manually before running on all 800:

```bash
psql $DATABASE_URL -c "SELECT id, name, \"countryCode\" FROM \"Publisher\" LIMIT 3;"
```

You may want to temporarily add `.slice(0, 3)` to the findMany result to limit the run.

Run: `pnpm scrape-contacts`
Expected: each publisher logs `[i/N] hostname — N candidates`. No crashes.

- [ ] **Step 3: Commit**

```bash
git add scripts/scrape-publisher-contacts.ts
git commit -m "feat(outreach): scrape-publisher-contacts CLI with per-host throttling"
```

---

## Task 17: Build + send CLI scripts

**Files:**
- Create: `scripts/build-rate-card-campaign.ts`
- Create: `scripts/send-rate-card-batch.ts`

- [ ] **Step 1: Implement build-rate-card-campaign.ts**

Create `scripts/build-rate-card-campaign.ts`:

```ts
#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { buildRateCardCampaign } from "@/lib/outreach/campaign";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const operator = await prisma.user.findFirstOrThrow({ where: { role: "SUPERADMIN" } });

  if (dryRun) {
    const contacts = await prisma.salesContact.count();
    const suppressed = await prisma.outreachSuppression.count();
    const existing = await prisma.rateCardRequest.count({ where: { cancelledAt: null, expiresAt: { gt: new Date() } } });
    console.log(`[build] dry-run: ${contacts} sales contacts, ${suppressed} suppressed, ${existing} active requests`);
    await prisma.$disconnect();
    return;
  }

  const result = await buildRateCardCampaign({ createdById: operator.id });
  console.log(`[build] done. created=${result.requests_created} skipped=${result.requests_skipped} titles_covered=${result.titles_covered}`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Implement send-rate-card-batch.ts**

Create `scripts/send-rate-card-batch.ts`:

```ts
#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { selectBatchForSend, sendRateCardStep } from "@/lib/outreach/campaign";

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : parseInt(process.env.OUTREACH_DAILY_CAP ?? "20", 10);
  const dryRun = process.argv.includes("--dry-run");

  const operator = await prisma.user.findFirstOrThrow({ where: { role: "SUPERADMIN" } });
  const batch = await selectBatchForSend({ limit });

  console.log(`[send] selected ${batch.length} requests (limit=${limit}, dry-run=${dryRun})`);

  let sent = 0;
  const skipped: Record<string, number> = {};
  for (const r of batch) {
    if (dryRun) {
      console.log(`  - ${r.recipientEmail} sentCount=${r.sentCount} -> would-send`);
      continue;
    }
    const result = await sendRateCardStep({ requestId: r.id, actorId: operator.id });
    if ("sent" in result) {
      sent++;
      console.log(`  ✓ ${r.recipientEmail} (${result.sent})`);
    } else {
      skipped[result.skipped] = (skipped[result.skipped] ?? 0) + 1;
      console.log(`  - ${r.recipientEmail} skipped: ${result.skipped}`);
      if (result.skipped === "rate_limited") break; // abort batch
    }
  }

  console.log(`\n[send] done. sent=${sent} skipped=${JSON.stringify(skipped)}`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Smoke-run dry**

Run: `pnpm build-rate-card-campaign --dry-run`
Expected: prints counts; no rows written.

Run: `pnpm send-rate-card-batch --dry-run --limit=5`
Expected: prints "would-send" lines; no emails sent.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-rate-card-campaign.ts scripts/send-rate-card-batch.ts
git commit -m "feat(outreach): build + send CLI scripts with --dry-run"
```

---

## Task 18: Desk admin UI — publisher-contacts page (server + actions)

**Files:**
- Create: `src/app/[locale]/desk/publisher-contacts/page.tsx`
- Create: `src/app/[locale]/desk/publisher-contacts/actions.ts`

- [ ] **Step 1: Implement actions.ts**

Create `src/app/[locale]/desk/publisher-contacts/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  approveCandidate,
  rejectCandidate,
  bulkApproveAboveConfidence,
} from "@/lib/outreach/candidates";
import { buildRateCardCampaign, selectBatchForSend, sendRateCardStep } from "@/lib/outreach/campaign";
import { prisma } from "@/lib/prisma";

async function requireSuperadmin(locale: string): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SUPERADMIN") {
    redirect(`/${locale}/desk/titles`);
  }
  return session.user.id;
}

function f(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function approveCandidateAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const candidateId = f(formData, "candidateId");
  if (!candidateId) redirect(`/${locale}/desk/publisher-contacts?err=missing-id`);

  const overrides = {
    email: f(formData, "email") || undefined,
    name: f(formData, "name") || undefined,
    role: f(formData, "role") || undefined,
    phone: f(formData, "phone") || undefined,
  };
  try {
    await approveCandidate({ candidateId, reviewedById: userId, overrides });
    redirect(`/${locale}/desk/publisher-contacts?ok=approved`);
  } catch (err) {
    redirect(`/${locale}/desk/publisher-contacts?err=${encodeURIComponent((err as Error).message)}`);
  }
}

export async function rejectCandidateAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const candidateId = f(formData, "candidateId");
  await rejectCandidate({ candidateId, reviewedById: userId, reason: f(formData, "reason") || undefined });
  redirect(`/${locale}/desk/publisher-contacts?ok=rejected`);
}

export async function bulkApproveAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const min = parseInt(f(formData, "minConfidence") || "80", 10);
  const result = await bulkApproveAboveConfidence({ minConfidence: min, reviewedById: userId });
  redirect(`/${locale}/desk/publisher-contacts?ok=bulk&approved=${result.approved}&failed=${result.failed}`);
}

export async function buildCampaignAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const result = await buildRateCardCampaign({ createdById: userId });
  redirect(`/${locale}/desk/publisher-contacts?tab=campaign&ok=built&created=${result.requests_created}&skipped=${result.requests_skipped}`);
}

export async function sendBatchAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const limit = parseInt(f(formData, "limit") || "20", 10);
  const batch = await selectBatchForSend({ limit });
  let sent = 0;
  for (const r of batch) {
    const result = await sendRateCardStep({ requestId: r.id, actorId: userId });
    if ("sent" in result) sent++;
    if ("skipped" in result && result.skipped === "rate_limited") break;
  }
  redirect(`/${locale}/desk/publisher-contacts?tab=campaign&ok=sent&n=${sent}`);
}

export async function sendOneAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const requestId = f(formData, "requestId");
  await sendRateCardStep({ requestId, actorId: userId });
  redirect(`/${locale}/desk/publisher-contacts?tab=campaign&ok=one`);
}
```

- [ ] **Step 2: Implement page.tsx**

Create `src/app/[locale]/desk/publisher-contacts/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  approveCandidateAction,
  rejectCandidateAction,
  bulkApproveAction,
  buildCampaignAction,
  sendBatchAction,
  sendOneAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function PublisherContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; status?: string; market?: string; minConf?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SUPERADMIN") {
    redirect(`/${locale}/desk/titles`);
  }

  const tab = sp.tab ?? "review";

  if (tab === "campaign") {
    const requests = await prisma.rateCardRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { titles: true },
    });
    const counts = {
      total: requests.length,
      draft: requests.filter((r) => r.sentCount === 0).length,
      sent: requests.filter((r) => r.sentCount > 0 && !r.respondedAt && !r.cancelledAt).length,
      responded: requests.filter((r) => r.respondedAt).length,
      cancelled: requests.filter((r) => r.cancelledAt).length,
    };

    return (
      <div className="p-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Outreach campaign</h1>
          <nav className="text-sm text-slate-500 mt-2">
            <a href={`/${locale}/desk/publisher-contacts`} className="underline">Review candidates</a>
            <span className="mx-2">·</span>
            <strong>Campaign</strong>
          </nav>
        </header>

        <section className="flex gap-4">
          <form action={buildCampaignAction}>
            <input type="hidden" name="locale" value={locale} />
            <button className="px-3 py-2 bg-slate-900 text-white rounded">Build / refresh campaign</button>
          </form>
          <form action={sendBatchAction}>
            <input type="hidden" name="locale" value={locale} />
            <input name="limit" type="number" defaultValue={20} className="border rounded px-2 py-1 w-20" />
            <button className="ml-2 px-3 py-2 bg-emerald-700 text-white rounded">Send batch (next due)</button>
          </form>
        </section>

        <section className="grid grid-cols-5 gap-4 text-sm">
          <div className="border rounded p-3"><div className="text-slate-500">Total</div><div className="text-2xl">{counts.total}</div></div>
          <div className="border rounded p-3"><div className="text-slate-500">Draft</div><div className="text-2xl">{counts.draft}</div></div>
          <div className="border rounded p-3"><div className="text-slate-500">Sent</div><div className="text-2xl">{counts.sent}</div></div>
          <div className="border rounded p-3"><div className="text-slate-500">Responded</div><div className="text-2xl">{counts.responded}</div></div>
          <div className="border rounded p-3"><div className="text-slate-500">Cancelled</div><div className="text-2xl">{counts.cancelled}</div></div>
        </section>

        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th>Recipient</th><th>Titles</th><th>Locale</th><th>Step</th><th>Status</th><th>Next due</th><th></th></tr></thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-t">
                <td>{r.recipientEmail}<br /><span className="text-slate-500 text-xs">{r.recipientName ?? "—"}</span></td>
                <td>{r.titles.length}</td>
                <td>{r.locale}</td>
                <td>{r.sentCount}/3</td>
                <td>{r.cancelledAt ? "cancelled" : r.respondedAt ? "responded" : r.sentCount === 0 ? "draft" : "in flight"}</td>
                <td>{r.nextStepAt ? new Date(r.nextStepAt).toISOString().slice(0, 10) : "—"}</td>
                <td>
                  {!r.respondedAt && !r.cancelledAt && r.sentCount < 3 && (
                    <form action={sendOneAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="requestId" value={r.id} />
                      <button className="text-blue-700 underline">Send</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Default: review tab
  const candidates = await prisma.contactCandidate.findMany({
    where: { status: "PENDING" },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
    take: 200,
    include: {
      publisher: {
        select: {
          name: true,
          countryCode: true,
          titles: { select: { id: true } },
        },
      },
    },
  });

  const counts = await prisma.contactCandidate.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Publisher contact review</h1>
        <nav className="text-sm text-slate-500 mt-2">
          <strong>Review candidates</strong>
          <span className="mx-2">·</span>
          <a href={`/${locale}/desk/publisher-contacts?tab=campaign`} className="underline">Campaign</a>
        </nav>
      </header>

      <section className="flex gap-4 text-sm">
        {counts.map((c) => (
          <div key={c.status} className="border rounded px-3 py-2">
            <span className="text-slate-500">{c.status}</span>: <strong>{c._count._all}</strong>
          </div>
        ))}
      </section>

      <section>
        <form action={bulkApproveAction} className="flex gap-2 items-center">
          <input type="hidden" name="locale" value={locale} />
          <span className="text-sm">Bulk-approve all PENDING with confidence ≥</span>
          <input name="minConfidence" type="number" defaultValue={80} className="border rounded px-2 py-1 w-20" />
          <button className="px-3 py-2 bg-emerald-700 text-white rounded text-sm">Bulk-approve</button>
        </form>
      </section>

      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500"><th>Publisher</th><th>Market</th><th>Titles</th><th>Candidate</th><th>Conf.</th><th>Source</th><th>Actions</th></tr></thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.id} className="border-t align-top">
              <td className="py-2">{c.publisher.name}</td>
              <td>{c.publisher.countryCode}</td>
              <td>{c.publisher.titles.length}</td>
              <td>
                <div>{c.name ?? "—"}</div>
                <div className="text-slate-700">{c.email}</div>
                <div className="text-slate-500 text-xs">{c.role ?? ""}</div>
              </td>
              <td>{c.confidence}</td>
              <td><a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline text-xs">view</a></td>
              <td>
                <form action={approveCandidateAction} className="inline">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="candidateId" value={c.id} />
                  <button className="text-emerald-700 underline mr-3">Approve</button>
                </form>
                <form action={rejectCandidateAction} className="inline">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="candidateId" value={c.id} />
                  <button className="text-red-700 underline">Reject</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Smoke-test in dev**

Run: `pnpm dev`
Navigate (as superadmin user) to `/en/desk/publisher-contacts`. Verify the page renders and the campaign tab toggles.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/desk/publisher-contacts
git commit -m "feat(outreach): desk admin UI — candidate review + campaign tab"
```

---

## Task 19: Response page — server component + thanks + unsubscribe

**Files:**
- Create: `src/app/[locale]/rate-card/[token]/page.tsx`
- Create: `src/app/[locale]/rate-card/[token]/actions.ts`
- Create: `src/app/[locale]/rate-card/[token]/thanks/page.tsx`
- Create: `src/app/[locale]/rate-card/[token]/unsubscribe/page.tsx`

- [ ] **Step 1: Implement actions.ts**

Create `src/app/[locale]/rate-card/[token]/actions.ts`:

```ts
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { findRateCardRequestByToken } from "@/lib/outreach/campaign";
import { checkRateCardRequest } from "@/lib/outreach/tokens";
import { addSuppression } from "@/lib/outreach/suppression";
import { recordAudit } from "@/lib/audit";
import { rfqLimiter } from "@/lib/rate-limit";
import { presignUpload } from "@/lib/storage/r2";

function f(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function presignRateCardUpload(args: { token: string; filename: string; contentType: string }) {
  // Public action — only proceeds if the token resolves to an active request.
  const req = await findRateCardRequestByToken(args.token);
  if (!req) throw new Error("invalid_token");
  const verdict = checkRateCardRequest({ expiresAt: req.expiresAt, respondedAt: req.respondedAt, cancelledAt: req.cancelledAt });
  if (!verdict?.ok) throw new Error(`request_${verdict?.reason ?? "missing"}`);
  return presignUpload({
    prefix: `rate-cards/${args.token}`,
    filename: args.filename,
    contentType: args.contentType,
  });
}

export async function submitRateCardAction(formData: FormData) {
  const token = f(formData, "token");
  const locale = f(formData, "locale") || "en";

  const ip = await clientIp();
  const limited = await rfqLimiter.check(`rc-submit:${ip}:${token.slice(0, 16)}`);
  if (!limited.ok) redirect(`/${locale}/rate-card/${token}?error=rate`);

  const req = await findRateCardRequestByToken(token);
  if (!req) redirect(`/${locale}/rate-card/${token}`);
  const verdict = checkRateCardRequest({ expiresAt: req.expiresAt, respondedAt: req.respondedAt, cancelledAt: req.cancelledAt });
  if (!verdict?.ok) redirect(`/${locale}/rate-card/${token}`);

  const mediaKitUrl = f(formData, "mediaKitUrl") || null;
  const mediaKitObjectKey = f(formData, "mediaKitObjectKey") || null;
  const responseNote = f(formData, "responseNote") || null;
  const contactName = f(formData, "contactName") || null;
  const contactEmail = f(formData, "contactEmail") || null;
  const contactRole = f(formData, "contactRole") || null;
  const formatsOffered = (formData.getAll("formatsOffered") as string[]).filter(Boolean);

  type RateRow = { titleId: string; price: number; currency: string; unit: string };
  const responseData: RateRow[] = [];
  for (let i = 0; i < req.titles.length; i++) {
    const titleId = f(formData, `rates[${i}].titleId`);
    const skip = formData.get(`rates[${i}].skip`) === "on";
    const priceRaw = f(formData, `rates[${i}].price`);
    if (skip || !priceRaw || !titleId) continue;
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) continue;
    responseData.push({
      titleId,
      price,
      currency: f(formData, `rates[${i}].currency`).toUpperCase() || "EUR",
      unit: f(formData, `rates[${i}].unit`) || "CPM",
    });
  }

  const hasSomething = !!mediaKitUrl || !!mediaKitObjectKey || responseData.length > 0 || !!responseNote;
  if (!hasSomething) redirect(`/${locale}/rate-card/${token}?error=empty`);

  await prisma.rateCardRequest.update({
    where: { id: req.id },
    data: {
      mediaKitUrl,
      mediaKitObjectKey,
      responseNote,
      responseData: responseData.length > 0 ? (responseData as any) : undefined,
      formatsOffered,
      contactName,
      contactEmail,
      contactRole,
      respondedAt: new Date(),
      responseSource: "FORM",
    },
  });

  await recordAudit(`salescontact:${req.recipientEmail}`, "rate_card.submit", `RateCardRequest:${req.id}`, {
    source: "FORM",
    hasFile: !!mediaKitObjectKey,
    hasUrl: !!mediaKitUrl,
    hasPrices: responseData.length,
    hasNote: !!responseNote,
  });

  redirect(`/${locale}/rate-card/${token}/thanks`);
}

export async function unsubscribeAction(token: string) {
  const req = await findRateCardRequestByToken(token);
  if (!req) return;
  await prisma.rateCardRequest.update({ where: { id: req.id }, data: { cancelledAt: new Date() } });
  await addSuppression({ email: req.recipientEmail, reason: "unsubscribe" });
  await recordAudit(`salescontact:${req.recipientEmail}`, "outreach.unsubscribe", `RateCardRequest:${req.id}`);
}
```

- [ ] **Step 2: Implement page.tsx (server) — renders the form via the client component**

Create `src/app/[locale]/rate-card/[token]/page.tsx`:

```tsx
import { findRateCardRequestByToken, markRateCardOpened } from "@/lib/outreach/campaign";
import { checkRateCardRequest } from "@/lib/outreach/tokens";
import { submitRateCardAction } from "./actions";
import RateCardForm from "./_components/RateCardForm";

export const dynamic = "force-dynamic";

export default async function RateCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, token } = await params;
  const sp = await searchParams;
  const req = await findRateCardRequestByToken(token);

  if (!req) {
    return <main className="p-8 max-w-prose mx-auto"><h1 className="text-xl font-semibold">Link not found</h1><p>This rate-card link is invalid.</p></main>;
  }
  const verdict = checkRateCardRequest({ expiresAt: req.expiresAt, respondedAt: req.respondedAt, cancelledAt: req.cancelledAt });
  if (!verdict?.ok) {
    const messageMap: Record<string, string> = {
      expired: "This link has expired.",
      responded: "Thanks — we've already received your response.",
      cancelled: "This request has been cancelled.",
    };
    return <main className="p-8 max-w-prose mx-auto"><h1 className="text-xl font-semibold">Rate card request</h1><p>{messageMap[verdict.reason]}</p></main>;
  }

  await markRateCardOpened(token);

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">Rate card request</h1>
      <p className="mt-2 text-slate-700">
        Send us current native rate cards for the {req.titles.length} {req.titles.length === 1 ? "title" : "titles"} below.
        Link valid until {req.expiresAt.toISOString().slice(0, 10)}.
      </p>
      {sp.error === "empty" && <p className="mt-2 text-red-700">Please fill in at least one of: file, link, prices, or a note.</p>}
      {sp.error === "rate" && <p className="mt-2 text-red-700">Too many submissions — please wait a moment.</p>}
      <ul className="mt-3 text-sm text-slate-700 list-disc pl-5">
        {req.titles.map((t) => (
          <li key={t.titleId}>{t.title.name} <span className="text-slate-500">({t.title.market.code})</span></li>
        ))}
      </ul>

      <RateCardForm
        token={token}
        locale={locale}
        titles={req.titles.map((t) => ({ titleId: t.titleId, name: t.title.name, marketCode: t.title.market.code }))}
        defaultName={req.recipientName ?? ""}
        defaultEmail={req.recipientEmail}
        unsubscribeHref={`/${locale}/rate-card/${token}/unsubscribe`}
        submitAction={submitRateCardAction}
      />
    </main>
  );
}
```

- [ ] **Step 3: Implement thanks/page.tsx**

Create `src/app/[locale]/rate-card/[token]/thanks/page.tsx`:

```tsx
export default async function ThanksPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale } = await params;
  const copy: Record<string, { title: string; body: string }> = {
    en: { title: "Thanks!", body: "Your response is in. We'll be in touch when a relevant brief lands." },
    no: { title: "Takk!", body: "Vi har mottatt svaret ditt. Vi tar kontakt når en relevant henvendelse kommer." },
    sv: { title: "Tack!", body: "Vi har fått ditt svar. Vi hör av oss när en relevant förfrågan kommer." },
    da: { title: "Tak!", body: "Vi har modtaget dit svar. Vi vender tilbage når en relevant henvendelse kommer." },
    fi: { title: "Kiitos!", body: "Olemme saaneet vastauksesi. Otamme yhteyttä, kun olennainen kysely tulee." },
    de: { title: "Vielen Dank!", body: "Ihre Antwort ist eingegangen. Wir melden uns, wenn ein passendes Brief vorliegt." },
  };
  const c = copy[locale] ?? copy.en;
  return <main className="p-8 max-w-prose mx-auto"><h1 className="text-2xl font-semibold">{c.title}</h1><p className="mt-2">{c.body}</p></main>;
}
```

- [ ] **Step 4: Implement unsubscribe/page.tsx**

Create `src/app/[locale]/rate-card/[token]/unsubscribe/page.tsx`:

```tsx
import { unsubscribeAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  await unsubscribeAction(token);

  const copy: Record<string, { title: string; body: string }> = {
    en: { title: "Unsubscribed", body: "You will not receive further outreach from NativeSpin. Reach out at any time if that changes." },
    no: { title: "Avregistrert", body: "Du vil ikke motta flere e-poster fra NativeSpin. Ta gjerne kontakt om det endrer seg." },
    sv: { title: "Avregistrerad", body: "Du kommer inte att få fler mejl från NativeSpin. Hör gärna av dig om det ändras." },
    da: { title: "Afmeldt", body: "Du modtager ikke flere mails fra NativeSpin. Sig til hvis det ændrer sig." },
    fi: { title: "Peruutettu", body: "Et saa enää viestejä NativeSpiniltä. Otathan yhteyttä, jos tilanne muuttuu." },
    de: { title: "Abgemeldet", body: "Sie erhalten keine weiteren E-Mails von NativeSpin. Melden Sie sich gern, falls sich das ändert." },
  };
  const c = copy[locale] ?? copy.en;
  return <main className="p-8 max-w-prose mx-auto"><h1 className="text-2xl font-semibold">{c.title}</h1><p className="mt-2">{c.body}</p></main>;
}
```

- [ ] **Step 5: Commit (form component comes in Task 20)**

Wait — we can't commit until the RateCardForm exists. Move to Task 20, then commit both together.

---

## Task 20: Response form (client component with R2 upload)

**Files:**
- Create: `src/app/[locale]/rate-card/[token]/_components/RateCardForm.tsx`

- [ ] **Step 1: Implement RateCardForm.tsx**

Create `src/app/[locale]/rate-card/[token]/_components/RateCardForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { presignRateCardUpload } from "../actions";

type Title = { titleId: string; name: string; marketCode: string };

export default function RateCardForm({
  token,
  locale,
  titles,
  defaultName,
  defaultEmail,
  unsubscribeHref,
  submitAction,
}: {
  token: string;
  locale: string;
  titles: Title[];
  defaultName: string;
  defaultEmail: string;
  unsubscribeHref: string;
  submitAction: (formData: FormData) => Promise<void>;
}) {
  const [objectKey, setObjectKey] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setObjectKey(null);
    setUploading(true);
    try {
      const { url, key } = await presignRateCardUpload({
        token,
        filename: file.name,
        contentType: file.type,
      });
      const res = await fetch(url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!res.ok) throw new Error(`upload_failed_${res.status}`);
      setObjectKey(key);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      action={(fd) => startTransition(() => submitAction(fd))}
      className="mt-6 space-y-6"
      encType="multipart/form-data"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="mediaKitObjectKey" value={objectKey ?? ""} />

      <fieldset className="border rounded p-4">
        <legend className="px-2 text-sm font-medium">Send your rate card</legend>

        <label className="block mb-3">
          <span className="text-sm">Upload a file (PDF / PPTX / image, max 25 MB)</span>
          <input
            type="file"
            accept=".pdf,.pptx,.ppt,.png,.jpg,.jpeg"
            onChange={onFileChange}
            className="block mt-1"
          />
          {uploading && <span className="text-xs text-slate-500">Uploading…</span>}
          {objectKey && <span className="text-xs text-emerald-700">File uploaded.</span>}
          {uploadError && <span className="text-xs text-red-700">Upload failed: {uploadError}</span>}
        </label>

        <label className="block mb-3">
          <span className="text-sm">Or paste a URL to your rate card / media kit</span>
          <input name="mediaKitUrl" type="url" placeholder="https://…" className="block w-full border rounded px-2 py-1 mt-1" />
        </label>

        <details className="mt-2">
          <summary className="cursor-pointer text-sm">Or enter rates per title</summary>
          <table className="w-full text-sm mt-3">
            <thead><tr className="text-left text-slate-500"><th>Title</th><th>Price</th><th>Currency</th><th>Unit</th><th>Skip</th></tr></thead>
            <tbody>
              {titles.map((t, i) => (
                <tr key={t.titleId}>
                  <td>{t.name} <span className="text-slate-500 text-xs">({t.marketCode})</span></td>
                  <td><input name={`rates[${i}].titleId`} type="hidden" value={t.titleId} /><input name={`rates[${i}].price`} type="number" min="0" step="0.01" className="w-24 border rounded px-2 py-1" /></td>
                  <td>
                    <select name={`rates[${i}].currency`} className="border rounded px-2 py-1">
                      <option>EUR</option><option>NOK</option><option>SEK</option><option>DKK</option><option>GBP</option><option>CHF</option>
                    </select>
                  </td>
                  <td>
                    <select name={`rates[${i}].unit`} className="border rounded px-2 py-1">
                      <option>CPM</option><option>CPC</option><option>flat</option>
                    </select>
                  </td>
                  <td><input name={`rates[${i}].skip`} type="checkbox" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </fieldset>

      <fieldset className="border rounded p-4">
        <legend className="px-2 text-sm font-medium">Native formats you offer</legend>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            ["native_article", "Native article / advertorial"],
            ["sponsored_content", "Sponsored content"],
            ["brand_stories", "Brand stories"],
            ["video_native", "Native video"],
            ["native_display", "Native display"],
            ["other", "Other"],
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="checkbox" name="formatsOffered" value={value} /> {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="border rounded p-4">
        <legend className="px-2 text-sm font-medium">Contact for follow-up</legend>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <label>Name<input name="contactName" defaultValue={defaultName} className="w-full border rounded px-2 py-1" /></label>
          <label>Email<input name="contactEmail" type="email" defaultValue={defaultEmail} className="w-full border rounded px-2 py-1" /></label>
          <label>Role<input name="contactRole" className="w-full border rounded px-2 py-1" /></label>
        </div>
      </fieldset>

      <label className="block">
        <span className="text-sm">Short message (optional)</span>
        <textarea name="responseNote" rows={3} className="w-full border rounded px-2 py-1 mt-1" />
      </label>

      <div className="flex items-center justify-between">
        <button type="submit" disabled={pending || uploading} className="px-4 py-2 bg-slate-900 text-white rounded">
          {pending ? "Sending…" : "Send response"}
        </button>
        <a href={unsubscribeHref} className="text-sm text-slate-500 underline">Unsubscribe</a>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Smoke-test in dev**

Run: `pnpm dev`. Manually create a `RateCardRequest` row via Prisma Studio or psql with a known token, then visit `/en/rate-card/<token>`. Verify form renders, file picker shows, fields are wired.

- [ ] **Step 3: Commit Task 19 + Task 20 together**

```bash
git add src/app/\[locale\]/rate-card
git commit -m "feat(outreach): tokenised response page with R2 upload + form + thanks/unsubscribe"
```

---

## Task 21: Wire the Resend email adapter at boot

**Files:**
- Inspect: existing boot path
- Possibly create: `src/lib/mail/index.ts`

Some Next.js projects pick up the adapter lazily. Verify and add the wiring if missing.

- [ ] **Step 1: Check whether `makeResendAdapter` is called anywhere**

Run: `grep -rn "makeResendAdapter" src/`
Expected: ideally one site that wires it. If empty, proceed to step 2.

- [ ] **Step 2: Create boot file if needed**

Create `src/lib/mail/index.ts` (only if it doesn't already wire the adapter):

```ts
import { makeResendAdapter } from "./resend";
import { setEmailAdapter } from "../notify";

const adapter = makeResendAdapter();
if (adapter) setEmailAdapter(adapter);

export {};
```

Import this once from the auth path (e.g. top of `src/auth.ts`) so it runs on every request lifecycle:

```ts
import "@/lib/mail";
```

- [ ] **Step 3: Verify with a unit-style log**

Add a temporary `console.log("[mail] adapter wired:", !!adapter)` in `src/lib/mail/index.ts`. Run `pnpm dev` and confirm the log shows on first request. Remove the log after verifying.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mail src/auth.ts
git commit -m "chore(mail): wire Resend adapter on boot"
```

---

## Task 22: i18n — add `rateCard` namespace stub

**Files:**
- Modify: `src/messages/{en,no,sv,da,fi,de}.json`

For now the page UI is in inline English/Norwegian strings; long-term it should move to next-intl. For v1 we ship a minimal namespace to avoid hardcoded text drift.

- [ ] **Step 1: Add the `rateCard` namespace to each messages file**

In each of `src/messages/{en,no,sv,da,fi,de}.json`, add a top-level `rateCard` key with at least:

```json
{
  "rateCard": {
    "pageTitle": "...",
    "intro": "...",
    "upload": "...",
    "uploadHint": "...",
    "urlLabel": "...",
    "ratesLabel": "...",
    "formatsLabel": "...",
    "contactLabel": "...",
    "noteLabel": "...",
    "submit": "...",
    "unsubscribe": "..."
  }
}
```

Use the existing inline copy from `RateCardForm.tsx` / `page.tsx` for each locale.

- [ ] **Step 2: Refactor `RateCardForm.tsx` and `page.tsx` to read from translations**

Use `useTranslations("rateCard")` (client) and `getTranslations({ locale, namespace: "rateCard" })` (server) per existing patterns elsewhere in the codebase. Update inline strings to `t("pageTitle")` etc.

- [ ] **Step 3: Smoke-test all 6 locales**

Visit `/no/rate-card/<token>`, `/sv/rate-card/<token>`, ... `/de/rate-card/<token>`. Verify each renders the correct language.

- [ ] **Step 4: Commit**

```bash
git add src/messages src/app/\[locale\]/rate-card
git commit -m "i18n(outreach): rateCard namespace across 6 locales"
```

---

## Task 23: Verify build + typecheck + all tests

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: pass.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: pass (or fix surfaced issues).

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: all pass (including new `outreach/*` and `storage/r2`).

- [ ] **Step 4: Run production build**

Run: `pnpm build`
Expected: succeeds; no runtime warnings about missing env at build (env is read at request-time for R2).

---

## Task 24: Deploy + Railway smoke

**Files:** none (operational)

- [ ] **Step 1: Set Railway env vars**

Via `railway variables set` or the dashboard, set:
- `OUTREACH_DAILY_CAP=20`
- `OUTREACH_HOURLY_CAP=8`
- `OUTREACH_FROM="NativeSpin Partnerships <partnerships@nativespin.com>"`
- `OUTREACH_REPLY_TO=partnerships@nativespin.com`
- `R2_ACCOUNT_ID=<from Cloudflare>`
- `R2_ACCESS_KEY_ID=<from Cloudflare>`
- `R2_SECRET_ACCESS_KEY=<from Cloudflare>`
- `R2_BUCKET=nativespin-blob`
- Add `partnerships@nativespin.com` as a verified sender in Resend; confirm DKIM/SPF/DMARC are green.

- [ ] **Step 2: Create R2 bucket**

In Cloudflare R2 dashboard: create bucket `nativespin-blob`. Generate an API token with read+write on this bucket. Save credentials to env vars above.

- [ ] **Step 3: Deploy**

Push to main; Railway picks up the new code. Migration runs automatically (via `prisma migrate deploy` in the `start` script).

- [ ] **Step 4: Sanity-check the deployed app**

Open `/en/desk/publisher-contacts` as a superadmin user. The page should render with `Pending: 0` (no scrape yet).

- [ ] **Step 5: Run scraper on Railway**

Run: `railway run pnpm scrape-contacts`
Expected: prints per-publisher candidate counts; ends with summary.

- [ ] **Step 6: Manually review first 20 candidates in admin UI**

Open `/en/desk/publisher-contacts`, manually approve / edit / reject the top 20 by confidence as a sanity check. If extraction looks broken (lots of noise, wrong names), stop and adjust the scraper/scoring before scaling.

- [ ] **Step 7: Dry-run build**

Run: `railway run pnpm build-rate-card-campaign --dry-run`
Expected: prints counts.

- [ ] **Step 8: Real build campaign**

Run: `railway run pnpm build-rate-card-campaign`
Expected: creates RateCardRequest rows for each approved-contact email group.

- [ ] **Step 9: Send 5 test emails to internal addresses**

Insert a few test recipients via Prisma Studio or psql:
```sql
INSERT INTO "ContactCandidate" (...) -- skip; use the admin UI to approve a fake row pointing at your own email
```
Or simply override the `recipientEmail` of one already-built RateCardRequest to an internal address.

Run: `railway run pnpm send-rate-card-batch --limit=5`
Expected: each test email arrives, link works, response page renders with correct title list, R2 upload works, submit lands data in DB.

- [ ] **Step 10: First real batch**

Run: `railway run pnpm send-rate-card-batch --limit=20`
Expected: 20 real publishers receive the initial email. Monitor Resend dashboard for delivery / bounce / complaint metrics over the next 24 hours.

---

## What's Done When

After Task 24 completes successfully:

- Publishers in the DB have scraped & reviewed contact emails (or are queued as `PENDING` for further review).
- An admin can approve/reject candidates at `/desk/publisher-contacts`.
- The campaign is built (RateCardRequest rows exist for each unique recipient email).
- 20 emails/day go out via Resend, in the recipient's locale, with valid List-Unsubscribe headers.
- Recipients can respond at `/<locale>/rate-card/<token>` with a file upload (stored in R2), a URL, per-title prices, and/or a note.
- Unsubscribe writes to OutreachSuppression and cancels the request.
- Audit log captures every state transition.
- Desk has a "Campaign" tab summarising state.

Sub-system D (pipeline-status-UI for operators across the whole funnel) is the next spec.
