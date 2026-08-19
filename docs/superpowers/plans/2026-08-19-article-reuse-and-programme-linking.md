# Article Reuse and Campaign-Programme Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one `Article` be linked to many placements (`OrderLine`s) and many campaign-programme waves at once, replacing the 1:1 `Article.orderLineId` invariant and the free-text `SavedList.articleAngle` field with a shared `ArticlePlacement` join model.

**Architecture:** A new `ArticlePlacement` model (1:1 with `OrderLine`, many-to-one toward `Article`) carries everything that's genuinely per-placement — spec-check result, publisher retraction, and a `lockedAssetId` pointer that freezes a placement to a specific `ContentAsset` version once it goes `FINAL`, so later edits never retroactively change what's already live. `ContentAsset.status`/`reviewNotes` stay shared across every placement — they describe the writing, not any one outlet. `SavedList.articleId` replaces `SavedList.articleAngle`, reusing the existing article create/write/upload UI instead of a parallel mechanism.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Prisma/PostgreSQL, `tsx --test` (node:test), next-intl.

**Spec:** `docs/superpowers/specs/2026-08-19-article-reuse-and-programme-linking-design.md`

## Global Constraints

- One `OrderLine` ↔ zero-or-one `ArticlePlacement` (unique `orderLineId`); one `Article` ↔ many `ArticlePlacement`s. No cap on reuse.
- `specPassed`/`specNotes`/`retractedAt`/`retractedBy`/`retractionNote` live on `ArticlePlacement`, never on `ContentAsset`.
- `ContentAsset.status`/`reviewNotes` stay shared across every placement of an article.
- `FINAL` is never gated on `specPassed`. `specPassed` is purely informational per placement.
- The moment any `ContentAsset` reaches `FINAL`, every currently-unlocked `ArticlePlacement` of that article locks to it (`lockedAssetId`). A placement linked after that point locks immediately at link time if the article's latest version is already `FINAL`.
- Every action's redirect/notify target comes from an explicit form field the calling page provides, never from a DB lookup that would have to arbitrarily pick one of several placements.
- A programme wave is never auto-linked to the `OrderLine` its RFQ becomes — linking stays manual, via the existing link-to-placement flow.
- Every state-changing action records an audit entry via `recordAudit()`.

---

### Task 1: Schema — `ArticlePlacement` model and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_article_reuse/migration.sql`

**Interfaces:**
- Produces: `model ArticlePlacement` with fields `id, orderLineId (unique), articleId, lockedAssetId?, specPassed?, specNotes?, retractedAt?, retractedBy?, retractionNote?, createdAt, updatedAt`. `Article.orderLineId` and its unique index removed. `OrderLine.article` (direct relation) removed, replaced by `OrderLine.articlePlacement`. `Article.placements ArticlePlacement[]`. `SavedList.articleId` added, `SavedList.articleAngle` removed. `ContentAsset` loses `specPassed`, `retractedAt`, `retractedBy`, `retractionNote`; `RETRACTED` removed from `ContentAssetStatus`.

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, change `model OrderLine`: replace

```prisma
  brief        ContentBrief?
  article      Article?
  booking      PublisherBooking?
  trackedLinks TrackedLink[]
```

with

```prisma
  brief            ContentBrief?
  articlePlacement ArticlePlacement?
  booking          PublisherBooking?
  trackedLinks     TrackedLink[]
```

Change `model Article`: replace

```prisma
  orderLineId      String?       @unique
  orderLine        OrderLine?    @relation(fields: [orderLineId], references: [id])
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  versions ContentAsset[]

  @@index([organizationId])
  @@index([assignedWriterId])
}
```

with

```prisma
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  versions   ContentAsset[]
  placements ArticlePlacement[]
  savedLists SavedList[]

  @@index([organizationId])
  @@index([assignedWriterId])
}

model ArticlePlacement {
  id             String        @id @default(cuid())
  orderLineId    String        @unique
  orderLine      OrderLine     @relation(fields: [orderLineId], references: [id])
  articleId      String
  article        Article       @relation(fields: [articleId], references: [id])
  lockedAssetId  String?
  lockedAsset    ContentAsset? @relation(fields: [lockedAssetId], references: [id])
  specPassed     Boolean?
  specNotes      String?
  retractedAt    DateTime?
  retractedBy    String?
  retractionNote String?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@index([articleId])
}
```

In `model ContentAsset`, delete `specPassed Boolean?` and the three retraction fields
(`retractedAt`, `retractedBy`, `retractionNote`, plus the comment above them). Leave
`status`, `reviewNotes`, everything else untouched.

In the `ContentAssetStatus` enum, delete the `RETRACTED` member.

In `model SavedList`, find `articleAngle String?` and replace it with:

```prisma
  articleId String?
  article   Article? @relation(fields: [articleId], references: [id])
```

- [ ] **Step 2: Generate the migration (create-only, then hand-edit)**

```bash
pnpm prisma migrate dev --name article_reuse --create-only
```

Rewrite the generated SQL file to this exact shape (adjust generated constraint/index
names only if Prisma names them differently than shown — check the generated file's
own naming before overwriting, since Postgres identifier truncation can differ):

```sql
-- CreateTable
CREATE TABLE "ArticlePlacement" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "lockedAssetId" TEXT,
    "specPassed" BOOLEAN,
    "specNotes" TEXT,
    "retractedAt" TIMESTAMP(3),
    "retractedBy" TEXT,
    "retractionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticlePlacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArticlePlacement_orderLineId_key" ON "ArticlePlacement"("orderLineId");
CREATE INDEX "ArticlePlacement_articleId_idx" ON "ArticlePlacement"("articleId");

ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_lockedAssetId_fkey" FOREIGN KEY ("lockedAssetId") REFERENCES "ContentAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: SavedList gets articleId (additive)
ALTER TABLE "SavedList" ADD COLUMN "articleId" TEXT;
ALTER TABLE "SavedList" ADD CONSTRAINT "SavedList_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one ArticlePlacement per existing 1:1 Article.orderLineId link,
-- carrying over the (about-to-be-dropped) per-asset spec/retraction fields
-- from that article's latest ContentAsset version, and locking to that
-- version if its status was already FINAL.
INSERT INTO "ArticlePlacement" ("id", "orderLineId", "articleId", "lockedAssetId", "specPassed", "specNotes", "retractedAt", "retractedBy", "retractionNote", "createdAt", "updatedAt")
SELECT
  'plc_' || a.id,
  a."orderLineId",
  a.id,
  CASE WHEN latest.status = 'FINAL' THEN latest.id ELSE NULL END,
  latest."specPassed",
  latest."reviewNotes",
  latest."retractedAt",
  latest."retractedBy",
  latest."retractionNote",
  a."createdAt",
  a."updatedAt"
FROM "Article" a
JOIN LATERAL (
  SELECT ca.id, ca.status, ca."specPassed", ca."reviewNotes", ca."retractedAt", ca."retractedBy", ca."retractionNote"
  FROM "ContentAsset" ca
  WHERE ca."articleId" = a.id
  ORDER BY ca.version DESC
  LIMIT 1
) latest ON true
WHERE a."orderLineId" IS NOT NULL;

-- Now that the backfill has read them, drop the fields ArticlePlacement replaces.
ALTER TABLE "ContentAsset" DROP COLUMN "specPassed";
ALTER TABLE "ContentAsset" DROP COLUMN "retractedAt";
ALTER TABLE "ContentAsset" DROP COLUMN "retractedBy";
ALTER TABLE "ContentAsset" DROP COLUMN "retractionNote";

-- Drop the old 1:1 FK/index on Article.
ALTER TABLE "Article" DROP CONSTRAINT "Article_orderLineId_fkey";
DROP INDEX "Article_orderLineId_key";
ALTER TABLE "Article" DROP COLUMN "orderLineId";

-- Remove RETRACTED from ContentAssetStatus. Postgres can't drop an enum
-- value directly: build the replacement type, swap the column over, drop
-- the old type. No existing row can hold 'RETRACTED' at this point in a
-- fresh/local DB; if this were running against real data with retracted
-- assets, migrating status values BEFORE this ALTER would be required —
-- not needed here since retraction is being moved to ArticlePlacement in
-- the same release and nothing has deployed yet (see spec's Migration
-- section).
CREATE TYPE "ContentAssetStatus_new" AS ENUM ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'FINAL');
ALTER TABLE "ContentAsset" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ContentAsset" ALTER COLUMN "status" TYPE "ContentAssetStatus_new" USING ("status"::text::"ContentAssetStatus_new");
ALTER TABLE "ContentAsset" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "ContentAssetStatus";
ALTER TYPE "ContentAssetStatus_new" RENAME TO "ContentAssetStatus";
```

- [ ] **Step 3: Apply and regenerate**

```bash
pnpm prisma migrate dev
pnpm prisma:generate
```

Expected: applies cleanly. Confirm via `pnpm prisma migrate status` that it shows
"Database schema is up to date!" afterward.

- [ ] **Step 4: Verify the schema compiles**

Run: `pnpm typecheck`
Expected: many errors — every file that references `Article.orderLineId`,
`OrderLine.article`, `ContentAsset.specPassed`/`retractedAt`/`retractedBy`/
`retractionNote`, `ContentAssetStatus.RETRACTED`, or `SavedList.articleAngle`. This
is expected; later tasks fix them one by one. Just confirm the errors are all in
files this plan's later tasks list (Tasks 3-15 below), not somewhere unrelated.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add ArticlePlacement, drop 1:1 Article-OrderLine link"
```

---

### Task 2: Placement helper module

**Files:**
- Create: `src/lib/writers/placement.ts`
- Create: `src/lib/writers/placement.test.ts`

**Interfaces:**
- Consumes: `prisma` client, `ArticlePlacement`/`Article`/`ContentAsset` models from Task 1.
- Produces: `resolveEffectiveAsset(placement)`, `ensurePlacementForLine(args)`,
  `lockPlacementsOnFinal(articleId, assetId)`, `articleTitleForLine(orderLineId)`
  — consumed by Tasks 3, 4, 5, 6, 7, 9. `articleTitleForLine` lives here (not
  inlined into `desk-content-actions.ts`) because TWO call sites need it: Task 5's
  `saveLineDraft` AND Task 5's fix to `writer-pool-actions.ts`'s
  `assignWriterToLine` — a shared module beats duplicating the same lookup twice.

- [ ] **Step 1: Write the file**

```ts
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type EffectiveAsset = {
  id: string;
  status: string;
  body: string | null;
  bodyUrl: string | null;
  reviewNotes: string | null;
};

// The display title a new Article gets when born from a specific line: the
// line's product/title name, falling back to a generic label. Shared by
// every line-keyed article-creation entry point (Task 5's saveLineDraft and
// its fix to writer-pool-actions.ts's assignWriterToLine).
export async function articleTitleForLine(orderLineId: string): Promise<string> {
  const line = await prisma.orderLine.findUnique({
    where: { id: orderLineId },
    select: { productId: true },
  });
  const product = line?.productId
    ? await prisma.product.findUnique({
        where: { id: line.productId },
        select: { title: { select: { name: true } } },
      })
    : null;
  return product?.title.name ?? "Untitled article";
}

// Which ContentAsset a placement is currently showing: its locked version
// once one exists (set the moment any version of the article went FINAL
// while this placement was linked and unlocked), otherwise the article's
// latest version.
export async function resolveEffectiveAsset(placement: {
  articleId: string;
  lockedAssetId: string | null;
}): Promise<EffectiveAsset | null> {
  if (placement.lockedAssetId) {
    return prisma.contentAsset.findUnique({
      where: { id: placement.lockedAssetId },
      select: { id: true, status: true, body: true, bodyUrl: true, reviewNotes: true },
    });
  }
  return prisma.contentAsset.findFirst({
    where: { articleId: placement.articleId },
    orderBy: { version: "desc" },
    select: { id: true, status: true, body: true, bodyUrl: true, reviewNotes: true },
  });
}

// Idempotently gets (or creates) the ArticlePlacement + Article that owns a
// line's drafts. An OrderLine's placement can be born from either side —
// the desk staffing a writer, or the desk/a writer composing the first
// draft — so both call this rather than each running their own
// find-then-create.
//
// `assignedWriterId` is applied to the ARTICLE (writing assignment is
// shared across every placement of that article, not per-placement) on
// both the found-existing and newly-created paths; omit it entirely to
// leave an existing article's writer untouched.
export async function ensurePlacementForLine(args: {
  orderLineId: string;
  organizationId: string;
  title: string;
  createdByUserId: string;
  createdByRole: UserRole;
  assignedWriterId?: string | null;
}): Promise<{ id: string; articleId: string }> {
  const existing = await prisma.articlePlacement.findUnique({
    where: { orderLineId: args.orderLineId },
    select: { id: true, articleId: true },
  });
  if (existing) {
    if (args.assignedWriterId !== undefined) {
      await prisma.article.update({
        where: { id: existing.articleId },
        data: { assignedWriterId: args.assignedWriterId },
      });
    }
    return existing;
  }
  const article = await prisma.article.create({
    data: {
      organizationId: args.organizationId,
      title: args.title,
      createdByUserId: args.createdByUserId,
      createdByRole: args.createdByRole,
      assignedWriterId: args.assignedWriterId ?? null,
    },
  });
  try {
    return await prisma.articlePlacement.create({
      data: { orderLineId: args.orderLineId, articleId: article.id },
      select: { id: true, articleId: true },
    });
  } catch (error) {
    // Two first-writes for the same line can race on the unique
    // orderLineId (creating the Article isn't part of the same atomic
    // insert as claiming the placement) — the loser adopts the winner's
    // row. The loser's freshly-created Article is left orphaned
    // (unlinked, unreferenced by anything) rather than cleaned up —
    // harmless, and cheaper than adding transactional coordination for
    // an already-rare race.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.articlePlacement.findUniqueOrThrow({
        where: { orderLineId: args.orderLineId },
        select: { id: true, articleId: true },
      });
    }
    throw error;
  }
}

// Called right after a ContentAsset transitions to FINAL: every placement
// of that article not yet locked to a specific version locks to this one.
// Placements that already locked to an earlier FINAL version are left
// alone (each locks exactly once, at its own first FINAL).
export async function lockPlacementsOnFinal(articleId: string, assetId: string): Promise<void> {
  await prisma.articlePlacement.updateMany({
    where: { articleId, lockedAssetId: null },
    data: { lockedAssetId: assetId },
  });
}
```

- [ ] **Step 2: Write the tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { resolveEffectiveAsset, ensurePlacementForLine, lockPlacementsOnFinal } from "./placement";

test("resolveEffectiveAsset follows the latest version when unlocked", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Org 1", type: "ADVERTISER" } });
  const user = await prisma.user.create({ data: { email: `it-1-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id } });
  const article = await prisma.article.create({
    data: { organizationId: org.id, title: "T", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  const v1 = await prisma.contentAsset.create({ data: { articleId: article.id, version: 1, body: "v1" } });
  const v2 = await prisma.contentAsset.create({ data: { articleId: article.id, version: 2, body: "v2" } });

  const effective = await resolveEffectiveAsset({ articleId: article.id, lockedAssetId: null });
  assert.equal(effective?.id, v2.id);

  await prisma.contentAsset.deleteMany({ where: { articleId: article.id } });
  await prisma.article.delete({ where: { id: article.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  void v1;
});

test("resolveEffectiveAsset returns the locked version even after a newer one exists", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Org 2", type: "ADVERTISER" } });
  const user = await prisma.user.create({ data: { email: `it-2-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id } });
  const article = await prisma.article.create({
    data: { organizationId: org.id, title: "T", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  const v1 = await prisma.contentAsset.create({ data: { articleId: article.id, version: 1, body: "v1", status: "FINAL" } });
  await prisma.contentAsset.create({ data: { articleId: article.id, version: 2, body: "v2" } });

  const effective = await resolveEffectiveAsset({ articleId: article.id, lockedAssetId: v1.id });
  assert.equal(effective?.id, v1.id);
  assert.equal(effective?.body, "v1");

  await prisma.contentAsset.deleteMany({ where: { articleId: article.id } });
  await prisma.article.delete({ where: { id: article.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("ensurePlacementForLine creates on first call, reuses on second", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Org 3", type: "ADVERTISER" } });
  const user = await prisma.user.create({ data: { email: `it-3-${Date.now()}@example.com`, role: "DESK" } });
  const quote = await prisma.quote.create({ data: { organizationId: org.id, status: "ACCEPTED", currency: "EUR", total: 0 } });
  // NOTE: verify against the real schema (Task 1's migration output / current
  // prisma/schema.prisma) whether Quote needs requestId/subtotal/vatPct — an
  // earlier plan in this codebase found Quote requires a Request→Plan chain,
  // not a bare organizationId. Read the current Quote/Request/Plan/Order
  // models before running this test and adjust the setup to match; do not
  // assume the shape above compiles as written.
  const order = await prisma.order.create({ data: { organizationId: org.id, quoteId: quote.id, status: "CONFIRMED" } });
  const line = await prisma.orderLine.create({
    data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 },
  });

  const first = await ensurePlacementForLine({
    orderLineId: line.id,
    organizationId: org.id,
    title: "Untitled article",
    createdByUserId: user.id,
    createdByRole: "DESK",
  });
  const second = await ensurePlacementForLine({
    orderLineId: line.id,
    organizationId: org.id,
    title: "Untitled article",
    createdByUserId: user.id,
    createdByRole: "DESK",
  });
  assert.equal(first.id, second.id);
  assert.equal(first.articleId, second.articleId);
  assert.equal(await prisma.articlePlacement.count({ where: { orderLineId: line.id } }), 1);

  await prisma.articlePlacement.delete({ where: { id: first.id } });
  await prisma.article.delete({ where: { id: first.articleId } });
  await prisma.orderLine.delete({ where: { id: line.id } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.quote.delete({ where: { id: quote.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("lockPlacementsOnFinal locks every unlocked placement of the article, leaves already-locked ones alone", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Org 4", type: "ADVERTISER" } });
  const user = await prisma.user.create({ data: { email: `it-4-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id } });
  const article = await prisma.article.create({
    data: { organizationId: org.id, title: "T", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  const quote1 = await prisma.quote.create({ data: { organizationId: org.id, status: "ACCEPTED", currency: "EUR", total: 0 } });
  const order1 = await prisma.order.create({ data: { organizationId: org.id, quoteId: quote1.id, status: "CONFIRMED" } });
  const line1 = await prisma.orderLine.create({ data: { orderId: order1.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 } });
  const quote2 = await prisma.quote.create({ data: { organizationId: org.id, status: "ACCEPTED", currency: "EUR", total: 0 } });
  const order2 = await prisma.order.create({ data: { organizationId: org.id, quoteId: quote2.id, status: "CONFIRMED" } });
  const line2 = await prisma.orderLine.create({ data: { orderId: order2.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 } });

  const placement1 = await prisma.articlePlacement.create({ data: { orderLineId: line1.id, articleId: article.id } });
  const placement2 = await prisma.articlePlacement.create({ data: { orderLineId: line2.id, articleId: article.id, lockedAssetId: (await prisma.contentAsset.create({ data: { articleId: article.id, version: 1, body: "old", status: "FINAL" } })).id } });

  const v2 = await prisma.contentAsset.create({ data: { articleId: article.id, version: 2, body: "new", status: "FINAL" } });
  await lockPlacementsOnFinal(article.id, v2.id);

  const reloaded1 = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placement1.id } });
  const reloaded2 = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placement2.id } });
  assert.equal(reloaded1.lockedAssetId, v2.id);
  assert.notEqual(reloaded2.lockedAssetId, v2.id);

  await prisma.articlePlacement.deleteMany({ where: { articleId: article.id } });
  await prisma.contentAsset.deleteMany({ where: { articleId: article.id } });
  await prisma.article.delete({ where: { id: article.id } });
  await prisma.orderLine.deleteMany({ where: { id: { in: [line1.id, line2.id] } } });
  await prisma.order.deleteMany({ where: { id: { in: [order1.id, order2.id] } } });
  await prisma.quote.deleteMany({ where: { id: { in: [quote1.id, quote2.id] } } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});
```

- [ ] **Step 3: Run**

Run: `ALLOW_LOCAL_DB=1 pnpm exec tsx --test src/lib/writers/placement.test.ts`
Expected: PASS, 4 tests. If the `Quote`/`Order` setup shape doesn't match the real
schema, fix the test setup to match what's actually required (read
`prisma/schema.prisma`'s current `Quote`/`Request`/`Plan`/`Order` models) — the
comment in the test above flags this explicitly as unverified.

- [ ] **Step 4: Commit**

```bash
git add src/lib/writers/placement.ts src/lib/writers/placement.test.ts
git commit -m "feat(writers): add ArticlePlacement helper module"
```

---

### Task 3: `spec-check-runner.ts` — per placement

**Files:**
- Modify: `src/lib/spec-check-runner.ts`

**Interfaces:**
- Consumes: `resolveEffectiveAsset` (Task 2).
- Produces: `runSpecCheckForPlacement(placementId: string): Promise<void>` — replaces
  `runSpecCheckForAsset`. Consumed by Task 5's `runSpecCheck` action.

- [ ] **Step 1: Rewrite the file**

```ts
// Pulls a placement's effective asset (locked version if one exists,
// otherwise the article's latest), looks up the placement's product spec +
// title's market, runs `specCheck`, persists the result onto the
// placement — never onto the shared ContentAsset, since two placements of
// the same article can have different product requirements.

import { prisma } from "@/lib/prisma";
import { registerJob } from "@/lib/jobs";
import { specCheck } from "@/lib/spec-check";
import { resolveEffectiveAsset } from "@/lib/writers/placement";

export async function runSpecCheckForPlacement(placementId: string): Promise<void> {
  const placement = await prisma.articlePlacement.findUnique({
    where: { id: placementId },
    include: { orderLine: { select: { productId: true } } },
  });
  if (!placement) return;

  const asset = await resolveEffectiveAsset(placement);
  if (!asset?.body) return; // no text, or an uploaded file — never spec-checked

  const productId = placement.orderLine.productId;
  if (!productId) return;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      spec: true,
      title: { include: { market: { select: { disclosureLabel: true } } } },
    },
  });
  const result = specCheck({
    body: asset.body,
    wordCountMin: product?.spec?.wordCountMin ?? null,
    wordCountMax: product?.spec?.wordCountMax ?? null,
    titleDisclosure: product?.spec?.disclosureLabel ?? null,
    marketDisclosure: product?.title.market.disclosureLabel ?? null,
  });

  await prisma.articlePlacement.update({
    where: { id: placement.id },
    data: {
      specPassed: result.passed,
      specNotes: result.passed
        ? `Spec passed (${result.words} words)`
        : result.issues.join("; "),
    },
  });
}

let registered = false;
export function registerSpecCheckJob(): void {
  if (registered) return;
  registered = true;
  registerJob<{ placementId: string }>("spec.check", async ({ placementId }) => {
    await runSpecCheckForPlacement(placementId);
  });
}
```

Note the job payload key changes from `assetId` to `placementId` — Task 5's
`saveLineDraft`/`saveDraft` enqueue calls must match (they only enqueue when a
placement already exists to check against; an unlinked article has none yet, so
nothing is enqueued for it — see Task 5).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "spec-check-runner"`
Expected: no errors from this file itself (errors in files that still call the old
`runSpecCheckForAsset`/enqueue with `assetId` are expected until Task 5 lands).

- [ ] **Step 3: Commit**

```bash
git add src/lib/spec-check-runner.ts
git commit -m "feat(content): run spec check per ArticlePlacement, not per asset"
```

---

### Task 4: `article-library-actions.ts` — link/unlink rewrite

**Files:**
- Modify: `src/app/article-library-actions.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks in this plan (`requireArticleWriter`,
  `loadScope`/`canActOnOrg`, `recordAudit` unchanged).
- Produces: `createArticle`, `presignArticleUpload` — UNCHANGED, do not touch.
  `linkArticleToOrderLine(formData)` — rewritten to create an `ArticlePlacement`
  instead of setting `Article.orderLineId`. New: `unlinkArticleFromOrderLine(formData)`.
  Consumed by Task 11 (article detail page) and Task 14 (programme wave UI, for
  `createArticle` only — waves never call link/unlink directly, see Task 13).

- [ ] **Step 1: Replace `linkArticleToOrderLine`, add `unlinkArticleFromOrderLine`**

Leave `createArticle` and `presignArticleUpload` exactly as they are. Replace
`linkArticleToOrderLine` (currently lines 59-104) with:

```ts
// Links an Article to an eligible INVENTORY OrderLine in the same
// organization that doesn't already have a placement. An article may be
// linked to any number of lines — the ArticlePlacement's unique
// orderLineId is what enforces "at most one article per line", not
// anything on Article.
export async function linkArticleToOrderLine(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const orderLineId = field(formData, "orderLineId");
  const { userId } = await requireArticleWriter(articleId, locale);

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      organizationId: true,
      versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, status: true } },
    },
  });
  if (!article) redirect(`/${locale}/articles/${articleId}`);

  const line = await prisma.orderLine.findUnique({
    where: { id: orderLineId },
    select: { kind: true, order: { select: { organizationId: true } } },
  });
  const scope = await loadScope();
  if (
    !line ||
    line.kind !== "INVENTORY" ||
    line.order.organizationId !== article.organizationId ||
    !canActOnOrg(scope, article.organizationId)
  ) {
    redirect(`/${locale}/articles/${articleId}?error=link`);
  }

  // If the article's latest version is already FINAL, this placement
  // locks to it immediately — there is no "still drafting" window to wait
  // through for a placement that arrives after the writing is done.
  const latest = article.versions[0];
  const lockedAssetId = latest?.status === "FINAL" ? latest.id : null;

  try {
    await prisma.articlePlacement.create({
      data: { orderLineId, articleId, lockedAssetId },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Unique violation — someone else linked this line first between our
      // read and write. Surface as a link error rather than a crash.
      redirect(`/${locale}/articles/${articleId}?error=taken`);
    }
    throw error;
  }
  await recordAudit(userId, "article.link", `Article:${articleId}`, { orderLineId });

  redirect(`/${locale}/articles/${articleId}`);
}

// Removes one placement without touching the article or any of its other
// placements.
export async function unlinkArticleFromOrderLine(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const placementId = field(formData, "placementId");
  const { userId } = await requireArticleWriter(articleId, locale);

  const placement = await prisma.articlePlacement.findUnique({
    where: { id: placementId },
    select: { articleId: true },
  });
  if (!placement || placement.articleId !== articleId) {
    redirect(`/${locale}/articles/${articleId}`);
  }

  await prisma.articlePlacement.delete({ where: { id: placementId } });
  await recordAudit(userId, "article.unlink", `Article:${articleId}`, { placementId });

  redirect(`/${locale}/articles/${articleId}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "article-library-actions"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/article-library-actions.ts
git commit -m "feat(content): rewrite article linking for many-placements-per-article"
```

---

### Task 5: `desk-content-actions.ts` rewrite

**Files:**
- Modify: `src/app/desk-content-actions.ts`
- Modify: `src/app/writer-pool-actions.ts`

**Interfaces:**
- Consumes: `ensurePlacementForLine`, `articleTitleForLine`, `lockPlacementsOnFinal`
  (Task 2, replacing `ensureArticleForLine`/`articleTitleForLine` imported from the
  old `@/lib/writers/article`, which this task deletes). `runSpecCheckForPlacement`
  (Task 3, replacing `runSpecCheckForAsset`).
- Produces: `confirmTrackedLinks` (UNCHANGED), `saveDraft`, `saveLineDraft`,
  `saveUploadedDraft`, `runSpecCheck`, `setAssetStatus` — all rewritten. Consumed by
  Task 8 (writer page), Task 9 (batch: desk order page forms), Task 11 (article
  detail page). `writer-pool-actions.ts`'s `assignWriterToLine` is also fixed here
  (found during Task 1's review — it imports from the same soon-deleted
  `@/lib/writers/article`, and its unassign branch writes to `Article.orderLineId`,
  a field Task 1 removed).

- [ ] **Step 1: Replace the whole file**

```ts
"use server";

import { redirect } from "next/navigation";
import { ContentAssetStatus, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg } from "@/lib/notify";
import { enqueue } from "@/lib/jobs";
import { runSpecCheckForPlacement, registerSpecCheckJob } from "@/lib/spec-check-runner";
import { ensureTrackedLinks } from "@/lib/metrics/store";
import { rewriteBodyLinks } from "@/lib/metrics/links";
import { requireLineWriter, requireArticleWriter } from "@/lib/writers/guard";
import { ensurePlacementForLine, articleTitleForLine } from "@/lib/writers/placement";

registerSpecCheckJob();

const ASSET_TARGETS: ContentAssetStatus[] = [
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "FINAL",
];

const SELF_SERVE_ASSET_TARGETS: ReadonlySet<ContentAssetStatus> = new Set([
  ContentAssetStatus.IN_REVIEW,
]);

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Where a content action returns the actor to. `orderLineIdHint`, when
// present, comes from a page that has a specific-placement context (the
// writer's line page) — an article with many placements has no single
// "the" line to derive this from, so it is always an explicit form field,
// never a lookup. Desk/superadmin and everyone else land on the article
// page; only a journalist with a line-context hint goes back to their own
// writer page, which is the only surface that shows the ContentBrief.
function afterContentAction(args: {
  locale: string;
  role: string;
  articleId: string;
  orderLineIdHint: string | null;
}): string {
  const { locale, role, articleId, orderLineIdHint } = args;
  if (role === "CONTENT" && orderLineIdHint) {
    return `/${locale}/writer/lines/${orderLineIdHint}`;
  }
  return `/${locale}/articles/${articleId}`;
}

// Appends a new DRAFT version to an article. Shared by the article-keyed
// and the line-keyed entry points below so both produce identical rows.
// Enqueues a spec check only when a placement is given — an unlinked
// article has no product to check against yet (spec-check-runner would
// just no-op, but there's nothing useful to enqueue for).
async function appendDraftVersion(args: {
  articleId: string;
  body: string;
  sourceAssetId: string | null;
  writerProfileId: string | null;
  userId: string;
  placementIdsToCheck: string[];
}): Promise<void> {
  const latest = await prisma.contentAsset.findFirst({
    where: { articleId: args.articleId },
    orderBy: { version: "desc" },
  });
  const nextVersion = (latest?.version ?? 0) + 1;
  const asset = await prisma.contentAsset.create({
    data: {
      articleId: args.articleId,
      version: nextVersion,
      status: "DRAFT",
      body: args.body,
      sourceAssetId: args.sourceAssetId,
      authorWriterId: args.writerProfileId,
    },
  });
  await recordAudit(args.userId, "asset.draft", `ContentAsset:${asset.id}`, {
    version: nextVersion,
    sourceAssetId: args.sourceAssetId,
  });
  for (const placementId of args.placementIdsToCheck) {
    await enqueue("spec.check", { placementId });
  }
}

// Desk confirms which auto-detected outbound links in a produced article
// to track. Each chosen URL becomes a TrackedLink (idempotent) and the
// asset body is rewritten so the published article uses /go/<token>.
// UNCHANGED from before this task — still line-keyed, still reads/writes
// ContentAsset.body directly by assetId.
export async function confirmTrackedLinks(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const orderLineId = field(formData, "orderLineId");
  const assetId = field(formData, "assetId");
  const { userId } = await requireLineWriter(orderLineId, locale);

  const chosen = formData
    .getAll("trackUrl")
    .map((v) => String(v))
    .filter((url) => /^https?:\/\//.test(url))
    .map((url) => ({ url, label: null }));

  if (chosen.length) {
    const map = await ensureTrackedLinks(orderLineId, chosen);
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      select: { id: true, body: true },
    });
    if (asset?.body) {
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: { body: rewriteBodyLinks(asset.body, map) },
      });
    }
    await recordAudit(userId, "asset.track_links", `ContentAsset:${assetId}`, {
      count: chosen.length,
    });
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function saveDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const body = field(formData, "body");
  const sourceAssetId = field(formData, "sourceAssetId") || null;
  const orderLineIdHint = field(formData, "orderLineId") || null;
  const { userId, writerProfileId, role } = await requireArticleWriter(articleId, locale);

  if (body) {
    const placements = await prisma.articlePlacement.findMany({
      where: { articleId },
      select: { id: true },
    });
    await appendDraftVersion({
      articleId,
      body,
      sourceAssetId,
      writerProfileId,
      userId,
      placementIdsToCheck: placements.map((p) => p.id),
    });
  }
  redirect(afterContentAction({ locale, role, articleId, orderLineIdHint }));
}

// The desk composes drafts from the order page, where the unit of work is
// the order line, not the article. A line drafted before any writer is
// staffed has no placement yet, so create one on the way in.
export async function saveLineDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderLineId = field(formData, "orderLineId");
  const body = field(formData, "body");
  const sourceAssetId = field(formData, "sourceAssetId") || null;
  const { userId, writerProfileId, role } = await requireLineWriter(orderLineId, locale);

  const line = await prisma.orderLine.findUnique({
    where: { id: orderLineId },
    select: {
      orderId: true,
      assignedWriterId: true,
      order: { select: { organizationId: true } },
    },
  });
  if (!line) redirect(`/${locale}/desk/orders`);

  const back =
    role === "CONTENT"
      ? `/${locale}/writer/lines/${orderLineId}`
      : `/${locale}/desk/orders/${line.orderId}`;

  if (body) {
    const placement = await ensurePlacementForLine({
      orderLineId,
      organizationId: line.order.organizationId,
      title: await articleTitleForLine(orderLineId),
      createdByUserId: userId,
      createdByRole: role as UserRole,
      assignedWriterId: line.assignedWriterId,
    });
    await appendDraftVersion({
      articleId: placement.articleId,
      body,
      sourceAssetId,
      writerProfileId,
      userId,
      placementIdsToCheck: [placement.id],
    });
  }
  redirect(back);
}

// The client obtains a presigned PUT url via presignArticleUpload
// (src/app/article-library-actions.ts), PUTs the file directly to R2, then
// submits this action with the returned key as bodyUrl.
export async function saveUploadedDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const bodyUrl = field(formData, "bodyUrl");
  const orderLineIdHint = field(formData, "orderLineId") || null;
  const { userId, writerProfileId, role } = await requireArticleWriter(articleId, locale);
  const back = afterContentAction({ locale, role, articleId, orderLineIdHint });

  // The key round-trips through the browser after the presigned PUT, so it
  // is user-controlled. Pin it to the prefix presignArticleUpload issues
  // for THIS article — otherwise a crafted submit could store any object
  // key in the bucket and have the article page presign a download link
  // for it.
  if (bodyUrl && !bodyUrl.startsWith(`articles/${articleId}/`)) {
    redirect(back);
  }

  if (bodyUrl) {
    const latest = await prisma.contentAsset.findFirst({
      where: { articleId },
      orderBy: { version: "desc" },
    });
    const nextVersion = (latest?.version ?? 0) + 1;
    const asset = await prisma.contentAsset.create({
      data: {
        articleId,
        version: nextVersion,
        status: "DRAFT",
        bodyUrl,
        authorWriterId: writerProfileId,
      },
    });
    await recordAudit(userId, "asset.draft_upload", `ContentAsset:${asset.id}`, {
      version: nextVersion,
    });
    // No spec.check enqueue — uploaded files are never spec-checked.
  }
  redirect(back);
}

// Runs spec check for one specific placement's effective asset. `placementId`
// is required now — spec check is a per-placement concept (Task 3), so
// there is no longer an assetId-keyed entry point.
export async function runSpecCheck(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const placementId = field(formData, "placementId");
  const placement = await prisma.articlePlacement.findUnique({
    where: { id: placementId },
    select: { articleId: true, orderLineId: true },
  });
  const articleId = placement?.articleId ?? "";
  const { userId, role } = await requireArticleWriter(articleId, locale);

  await runSpecCheckForPlacement(placementId);
  await recordAudit(userId, "placement.spec_check", `ArticlePlacement:${placementId}`);

  redirect(afterContentAction({ locale, role, articleId, orderLineIdHint: placement?.orderLineId ?? null }));
}

export async function setAssetStatus(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const target = field(formData, "target") as ContentAssetStatus;
  const orderLineIdHint = field(formData, "orderLineId") || null;
  const assetForArticle = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { articleId: true },
  });
  const articleId = assetForArticle?.articleId ?? "";
  const { userId, role } = await requireArticleWriter(articleId, locale);
  const back = afterContentAction({ locale, role, articleId, orderLineIdHint });

  // Only the desk drives the full status machine. Every other role that
  // can reach this action — journalist, buyer, approver, org admin — may
  // only hand a draft over for review from here.
  if (role !== "DESK" && role !== "SUPERADMIN" && !SELF_SERVE_ASSET_TARGETS.has(target)) {
    redirect(back);
  }

  if (ASSET_TARGETS.includes(target)) {
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      include: { article: { select: { organizationId: true } } },
    });
    if (asset) {
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: { status: target },
      });
      // FINAL is never gated on spec compliance (that's per-placement,
      // informational only) — but it does lock every currently-unlocked
      // placement of this article to this exact version.
      if (target === "FINAL") {
        const { lockPlacementsOnFinal } = await import("@/lib/writers/placement");
        await lockPlacementsOnFinal(asset.articleId, asset.id);
      }
      await recordAudit(userId, "asset.status", `ContentAsset:${asset.id}`, {
        status: target,
      });
      if (target === "IN_REVIEW" || target === "CHANGES_REQUESTED") {
        const hintOrderId = orderLineIdHint
          ? (await prisma.orderLine.findUnique({
              where: { id: orderLineIdHint },
              select: { orderId: true },
            }))?.orderId
          : null;
        await notifyOrg(asset.article.organizationId, {
          kind: "ASSET_REVIEW",
          title:
            target === "IN_REVIEW"
              ? "Content draft ready for review"
              : "Content changes requested",
          link: hintOrderId
            ? `/${locale}/orders/${hintOrderId}`
            : `/${locale}/articles/${articleId}`,
        });
      }
    }
  }
  redirect(back);
}
```

Note: the `await import("@/lib/writers/placement")` inside `setAssetStatus` is
written as a dynamic import only to keep the top-level import list minimal where
`lockPlacementsOnFinal` is used exactly once — if this feels inconsistent with the
rest of the file's static imports, use a normal static `import { lockPlacementsOnFinal } from "@/lib/writers/placement";` at the top instead (alongside the existing
`ensurePlacementForLine` import); either is fine, prefer the static one for
consistency with the rest of this file's style.

- [ ] **Step 2: Fix `writer-pool-actions.ts`**

Found during Task 1's review: `src/app/writer-pool-actions.ts`'s `assignWriterToLine`
imports `ensureArticleForLine, articleTitleForLine` from `@/lib/writers/article` (the
file this task deletes below), and its unassign branch writes
`prisma.article.updateMany({ where: { orderLineId }, data: { assignedWriterId: null } })`
— `Article.orderLineId` no longer exists after Task 1.

Read the current file in full first. Change the import line from
```ts
import { ensureArticleForLine, articleTitleForLine } from "@/lib/writers/article";
```
to
```ts
import { ensurePlacementForLine, articleTitleForLine } from "@/lib/writers/placement";
```

Replace the unassign branch's `Article.updateMany` call — it can no longer filter
by `orderLineId` on `Article` directly, so it goes through the placement instead:
```ts
if (writerId === "") {
  await prisma.orderLine.update({
    where: { id: orderLineId },
    data: { assignedWriterId: null, assignedAt: null, assignedById: null },
  });
  const placement = await prisma.articlePlacement.findUnique({
    where: { orderLineId },
    select: { articleId: true },
  });
  if (placement) {
    await prisma.article.update({
      where: { id: placement.articleId },
      data: { assignedWriterId: null },
    });
  }
  await recordAudit(userId, "line.unassign", `OrderLine:${orderLineId}`);
  await recordAudit(userId, "article.unassign", `OrderLine:${orderLineId}`);
  redirect(`/${locale}/desk/orders/${orderId}`);
}
```

Replace the assign branch's `ensureArticleForLine(...)` call with
`ensurePlacementForLine(...)` — same argument shape, no other change:
```ts
await ensurePlacementForLine({
  orderLineId,
  organizationId: updatedLine.order.organizationId,
  title: await articleTitleForLine(orderLineId),
  createdByUserId: userId,
  createdByRole: "DESK",
  assignedWriterId: writerId,
});
await recordAudit(userId, "article.assign", `OrderLine:${orderLineId}`, { writerId });
```

The comment above the old call ("First assignment for this line creates its
Article... ensureArticleForLine keys on the unique orderLineId, so two concurrent
assignments... converge on one row instead of racing") should be updated to
reference `ensurePlacementForLine` and `ArticlePlacement.orderLineId` instead —
same idempotent-upsert behavior, new names.

- [ ] **Step 3: Delete `src/lib/writers/article.ts`**

Its two exports (`articleTitleForLine`, `ensureArticleForLine`) are now
`articleTitleForLine` and `ensurePlacementForLine`, both exported from
`src/lib/writers/placement.ts` (Task 2). Confirm nothing else imports the old file
(`grep -rn "lib/writers/article\"" src/` — after Steps 1-2 above, this should
return nothing) before deleting it.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "desk-content-actions\|writer-pool-actions"`
Expected: no errors from either file (other callers not yet updated — the writer
page, desk order page forms, article detail page — are expected to still error
until Tasks 8, 9, 11 land).

- [ ] **Step 5: Commit**

```bash
git add src/app/desk-content-actions.ts src/app/writer-pool-actions.ts
git rm src/lib/writers/article.ts
git commit -m "feat(content): rewrite desk-content-actions and writer-pool-actions for multi-placement articles"
```

---

### Task 6: `content-review-actions.ts` rewrite

**Files:**
- Modify: `src/app/content-review-actions.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `approveContentAsset`, `requestContentChanges` — both now accept an
  optional `orderId` hint field for redirect/notify, instead of deriving one
  ambiguous order from the (now nonexistent) `asset.article.orderLine`.

- [ ] **Step 1: Replace `loadAssetForBuyer` and both actions**

```ts
async function loadAssetForBuyer(assetId: string) {
  return prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      status: true,
      article: { select: { id: true, organizationId: true } },
    },
  });
}

export async function approveContentAsset(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId") || null;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const asset = await loadAssetForBuyer(assetId);
  const scope = await loadScope();
  if (
    !asset ||
    asset.status !== "IN_REVIEW" ||
    !canActOnOrg(scope, asset.article.organizationId)
  ) {
    redirect(`/${locale}/articles/${asset?.article.id ?? ""}`);
  }

  await prisma.contentAsset.update({ where: { id: assetId }, data: { status: "APPROVED" } });
  await recordAudit(session.user.id, "asset.status", `ContentAsset:${assetId}`, { status: "APPROVED" });
  await notifyDesk({
    kind: "ASSET_REVIEW",
    title: "Buyer approved a draft",
    link: orderId ? `/${locale}/desk/orders/${orderId}` : `/${locale}/articles/${asset.article.id}`,
  });

  redirect(orderId ? `/${locale}/orders/${orderId}` : `/${locale}/articles/${asset.article.id}`);
}

export async function requestContentChanges(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const note = field(formData, "note");
  const orderId = field(formData, "orderId") || null;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const asset = await loadAssetForBuyer(assetId);
  const scope = await loadScope();
  if (
    !asset ||
    asset.status !== "IN_REVIEW" ||
    !canActOnOrg(scope, asset.article.organizationId)
  ) {
    redirect(`/${locale}/articles/${asset?.article.id ?? ""}`);
  }

  await prisma.contentAsset.update({
    where: { id: assetId },
    data: { status: "CHANGES_REQUESTED", reviewNotes: note || null },
  });
  await recordAudit(session.user.id, "asset.status", `ContentAsset:${assetId}`, {
    status: "CHANGES_REQUESTED",
  });
  await notifyDesk({
    kind: "ASSET_REVIEW",
    title: "Buyer requested changes to a draft",
    link: orderId ? `/${locale}/desk/orders/${orderId}` : `/${locale}/articles/${asset.article.id}`,
  });

  redirect(orderId ? `/${locale}/orders/${orderId}` : `/${locale}/articles/${asset.article.id}`);
}
```

The `orderId` form field is a caller-supplied hint, not derived from the asset —
callers that already know which order they're acting from (Task 9's update to
`orders/[orderId]/page.tsx`) pass it; the article detail page (Task 11) does not,
since an article there may have zero, one, or many linked placements with no
single "the" order to hint at.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "content-review-actions"`
Expected: no errors from this file itself.

- [ ] **Step 3: Commit**

```bash
git add src/app/content-review-actions.ts
git commit -m "feat(content): thread orderId as an explicit hint, not a derived lookup"
```

---

### Task 7: `publisher-actions.ts` — retraction moves to `ArticlePlacement`

**Files:**
- Modify: `src/app/publisher-actions.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `rejectAsset` — writes retraction to the specific `ArticlePlacement`,
  not the shared `ContentAsset`.

- [ ] **Step 1: Rewrite `rejectAsset`**

Replace the function body (currently lines 259-333ish — read the current file to
confirm the exact end of the function before replacing) with:

```ts
export async function rejectAsset(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { publisherId, userId } = await requirePublisher(locale);
  const placementId = field(formData, "placementId");
  const reason = normaliseReason(field(formData, "reason"));

  if (!reason) {
    redirect(`/${locale}/publisher/orders?veto=reason-required`);
  }

  const placement = await prisma.articlePlacement.findUnique({
    where: { id: placementId },
    select: {
      retractedAt: true,
      orderLine: {
        select: {
          productId: true,
          order: { select: { id: true, organizationId: true } },
        },
      },
    },
  });

  if (!placement) {
    redirect(`/${locale}/publisher/orders?veto=not-found`);
  }

  const product = await prisma.product.findUnique({
    where: { id: placement.orderLine.productId ?? "" },
    select: { title: { select: { publisherId: true } } },
  });
  if (product?.title.publisherId !== publisherId) {
    redirect(`/${locale}/publisher/orders`);
  }

  if (placement.retractedAt) {
    redirect(`/${locale}/publisher/orders?veto=already-retracted`);
  }

  await prisma.articlePlacement.update({
    where: { id: placementId },
    data: {
      retractedAt: new Date(),
      retractedBy: userId,
      retractionNote: reason,
    },
  });

  await recordAudit(userId, "placement.retract", `ArticlePlacement:${placementId}`, {
    reason,
    publisherId,
  });

  const orderId = placement.orderLine.order.id;
  const orgId = placement.orderLine.order.organizationId;

  await notifyDesk({
    kind: "EDITORIAL_VETO",
    title: "Publisher invoked editorial veto",
    body: reason,
    link: `/${locale}/desk/orders/${orderId}`,
  });
  await notifyOrg(orgId, {
    kind: "EDITORIAL_VETO",
    title: "A publisher retracted your content",
    body: reason,
    link: `/${locale}/orders/${orderId}`,
  });

  redirect(`/${locale}/publisher/orders`);
}
```

Read the current file's exact end of `rejectAsset` (the `notifyDesk`/`notifyOrg`
calls and the trailing `redirect`) before replacing — reproduce its existing
`notifyDesk`/`notifyOrg` payload shape exactly (kind/title/body/link fields), only
changing what's shown above (`asset.article.orderLine...` → `placement.orderLine...`,
`asset.id`/`assetId` → `placementId`, the audit action name, and the
already-retracted / not-found guards now reading `placement.retractedAt` instead of
`canRetractAsset(asset.status)`). Do not invent a different notify payload shape
than what's already there.

Also update the file's form-field-reading call site: the veto form (rendered in
Task 9's batch update to `publisher/orders/page.tsx`) now posts `placementId`
instead of `assetId` — confirm the two changes match.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "publisher-actions"`
Expected: no errors from this file itself (the caller, `publisher/orders/page.tsx`,
is updated in Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/app/publisher-actions.ts
git commit -m "feat(content): move editorial veto retraction to ArticlePlacement"
```

---

### Task 8: `writer/lines/[lineId]/page.tsx` — read via `ArticlePlacement`

**Files:**
- Modify: `src/app/[locale]/writer/lines/[lineId]/page.tsx`

**Interfaces:**
- Consumes: `saveDraft`, `saveUploadedDraft`, `runSpecCheck`, `setAssetStatus`
  (Task 5) — all three now need an `orderLineId` hidden field so
  `afterContentAction` sends a CONTENT-role writer back to this same page, and
  `runSpecCheck`/spec-display now key off the placement, not the asset directly.

- [ ] **Step 1: Read the current file in full**

Read `src/app/[locale]/writer/lines/[lineId]/page.tsx` before editing — it queries
`OrderLine` including `brief` (message/audience/doNotes/dontNotes) and `article`
(id, versions). Under this plan's schema, `OrderLine.article` no longer exists;
the query must go through `articlePlacement` instead, and needs `lockedAssetId` to
resolve the effective asset the same way `resolveEffectiveAsset` does (either
inline the same two-branch logic, or import `resolveEffectiveAsset` from
`@/lib/writers/placement` and call it after the page's own `orderLine.findUnique` —
prefer reusing `resolveEffectiveAsset` over duplicating its logic).

- [ ] **Step 2: Rewrite the query and forms**

```tsx
import { prisma } from "@/lib/prisma";
import { requireLineWriter } from "@/lib/writers/guard";
import { resolveEffectiveAsset } from "@/lib/writers/placement";
import { saveDraft, runSpecCheck, setAssetStatus } from "@/app/desk-content-actions";

export default async function WriterLine({
  params,
}: {
  params: Promise<{ locale: string; lineId: string }>;
}) {
  const { locale, lineId } = await params;
  await requireLineWriter(lineId, locale); // redirects if not allowed

  const line = await prisma.orderLine.findUnique({
    where: { id: lineId },
    select: {
      id: true,
      orderId: true,
      brief: {
        select: {
          message: true,
          audience: true,
          doNotes: true,
          dontNotes: true,
        },
      },
      articlePlacement: {
        select: {
          id: true,
          articleId: true,
          lockedAssetId: true,
          specPassed: true,
        },
      },
    },
  });

  if (!line?.brief || !line.articlePlacement) {
    return <main className="p-6 text-sm">No brief for this line yet.</main>;
  }

  const articleId = line.articlePlacement.articleId;
  const latest = await resolveEffectiveAsset(line.articlePlacement);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <section>
        <h1 className="text-lg font-semibold">Brief</h1>
        <dl className="mt-2 space-y-1 text-sm">
          <div>
            <dt className="inline font-medium">Message: </dt>
            <dd className="inline">{line.brief.message}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Audience: </dt>
            <dd className="inline">{line.brief.audience}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Do: </dt>
            <dd className="inline">{line.brief.doNotes}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Don&apos;t: </dt>
            <dd className="inline">{line.brief.dontNotes}</dd>
          </div>
        </dl>
      </section>

      <form action={saveDraft} className="space-y-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="articleId" value={articleId} />
        <input type="hidden" name="orderLineId" value={line.id} />
        <label className="block text-sm font-medium">Article</label>
        <textarea
          name="body"
          defaultValue={latest?.bodyUrl ? "" : (latest?.body ?? "")}
          rows={18}
          className="w-full rounded border p-2 font-mono text-sm"
        />
        <button
          type="submit"
          className="rounded bg-black px-3 py-1.5 text-sm text-white"
        >
          Save draft
        </button>
      </form>

      {latest ? (
        <div className="flex items-center gap-4 text-sm">
          <span>
            Status: <strong>{latest.status}</strong>
            {line.articlePlacement.specPassed === true
              ? " · spec ✓"
              : line.articlePlacement.specPassed === false
                ? " · spec ✗"
                : ""}
          </span>
          <form action={runSpecCheck}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="placementId" value={line.articlePlacement.id} />
            <button type="submit" className="underline">
              Run spec check
            </button>
          </form>
          <form action={setAssetStatus}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="assetId" value={latest.id} />
            <input type="hidden" name="orderLineId" value={line.id} />
            <input type="hidden" name="target" value="IN_REVIEW" />
            <button type="submit" className="underline">
              Submit for review
            </button>
          </form>
        </div>
      ) : null}

      {latest?.reviewNotes ? (
        <p className="text-sm text-amber-700">
          Review notes: {latest.reviewNotes}
        </p>
      ) : null}
    </main>
  );
}
```

Note `runSpecCheck` now takes `placementId` (Task 5's rewrite), not `assetId` — the
form field name changed; `setAssetStatus` still takes `assetId` (it operates on a
specific `ContentAsset` version) plus the new `orderLineId` hint.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "writer/lines"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/writer/lines/[lineId]/page.tsx"
git commit -m "feat(content): read writer line page via ArticlePlacement"
```

---

### Task 9: Batch — remaining read sites and publisher retraction UI

**Files:**
- Modify: `src/app/[locale]/orders/[orderId]/page.tsx`
- Modify: `src/app/[locale]/publisher/orders/page.tsx`
- Modify: `src/app/[locale]/desk/orders/[orderId]/page.tsx`
- Modify: `src/app/[locale]/desk/orders/[orderId]/lines-section.tsx`
- Modify: `src/app/[locale]/desk/orders/[orderId]/campaign-section.tsx`
- Modify: `src/app/[locale]/requests/[id]/page.tsx`
- Modify: `src/app/[locale]/requests/[id]/_components/OrderSection.tsx`
- Modify: `src/app/[locale]/requests/[id]/_components/types.ts`
- Modify: `src/app/[locale]/writer/page.tsx`
- Modify: `src/lib/writers/roster.ts`
- Modify: `src/app/api/export/me/route.ts`
- Modify: `src/lib/writers/access.ts`
- Modify: `src/lib/writers/access.test.ts`

**Interfaces:**
- Consumes: `resolveEffectiveAsset` (Task 2) where a page needs the
  locked-vs-latest version, `approveContentAsset`/`requestContentChanges` (Task 6,
  now taking an optional `orderId` field), `rejectAsset` (Task 7, now taking
  `placementId`).

**The pattern, applied to every file below:** every one of these files currently
queries `OrderLine`/`Order.lines` with an `article: { include: { versions: {...} } }`
(or `select`) include, and reads `line.article?.versions[0]` (or the `types.ts`
`Prisma...GetPayload` type literal declaring the same shape). Replace with
`articlePlacement: { include: { article: { include: { versions: {...} } } } }` and
`line.articlePlacement?.article.versions[0]` — UNLESS the file needs the
locked-vs-latest resolution (i.e. it renders `specPassed`, or anything that should
reflect a specific placement rather than always "whatever's newest") — in that
case also select `articlePlacement.lockedAssetId`/`articlePlacement.specPassed`
and call `resolveEffectiveAsset(line.articlePlacement)` instead of reading
`versions[0]` directly. Read each file in full before editing — do not assume the
line numbers below are still exact after Tasks 1-8's changes; they're a starting
pointer, not a guarantee.

- [ ] **Step 1: `src/app/[locale]/orders/[orderId]/page.tsx`**

Read the current file in full. Change the `lines` include from
`article: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } }` to:

```ts
articlePlacement: {
  select: {
    id: true,
    articleId: true,
    lockedAssetId: true,
    specPassed: true,
  },
},
```

(`articleId` must be selected explicitly — `resolveEffectiveAsset` reads
`placement.articleId` directly, not `placement.article.id`; there's no need for
the nested `article: { select: { id: true } }` relation at all here.)

Replace `const latest = line.article?.versions[0];` with a resolved effective
asset per line — since this is now an async resolution per line (not a plain
include-and-read), do it as a loop before the JSX, alongside the existing
`draftDownloadUrls` loop that already iterates `order.lines`:

```ts
const effectiveAssets = new Map<string, Awaited<ReturnType<typeof resolveEffectiveAsset>>>();
for (const line of order.lines) {
  if (!line.articlePlacement) continue;
  effectiveAssets.set(line.id, await resolveEffectiveAsset(line.articlePlacement));
}
```

(Import `resolveEffectiveAsset` from `@/lib/writers/placement`.) In the render,
replace `const latest = line.article?.versions[0];` with
`const latest = effectiveAssets.get(line.id) ?? null;`, and replace
`latest.specPassed === true` with `line.articlePlacement?.specPassed === true`
(spec result lives on the placement now, not the resolved asset). The existing
`draftDownloadUrls` loop already keys off `line.article?.versions[0]` too — update
it to use the same `effectiveAssets` map instead of re-deriving.

The `approveContentAsset`/`requestContentChanges` forms in this file (rendered
inside the `latest.status === "IN_REVIEW"` block) must now also pass the order's
own id, since Task 6 made that an explicit hint rather than a derived lookup: add
`<input type="hidden" name="orderId" value={order.id} />` to both forms.

- [ ] **Step 2: `src/app/[locale]/publisher/orders/page.tsx`**

Read the current file in full. Change the `lines` query's `article: { include: {
versions: {...} } }` include to:

```ts
articlePlacement: {
  select: {
    id: true,
    articleId: true,
    retractedAt: true,
    retractionNote: true,
    article: {
      select: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        _count: { select: { placements: true } },
      },
    },
  },
},
```

`article._count.placements` is the total placement count for the article this
line's draft belongs to — used below for the spec's second warning ("a publisher
retracting their placement when the article has ≥1 other active placement"). A
raw count includes the placement being retracted itself, so the warning condition
subtracts one when checking (`count > 1`, not `count > 0`).

Replace the veto-block condition. Today:
```tsx
{line.article?.versions[0] &&
canRetractAsset(line.article.versions[0].status) ? (
```
becomes — retraction eligibility is no longer a `ContentAssetStatus` check
(`RETRACTED` was removed from that enum in Task 1) but a placement field:
```tsx
{line.articlePlacement?.article.versions[0] && !line.articlePlacement.retractedAt ? (
```
The `canRetractAsset` import and its remaining callers in `src/lib/cancellation.ts`
are addressed in Step 2b below — do not delete `canRetractAsset` itself yet, only
stop using it for this now-placement-shaped check in this file.

The hidden `assetId` field inside the veto form becomes `placementId`:
```tsx
<input type="hidden" name="placementId" value={line.articlePlacement.id} />
```
(matching Task 7's rewritten `rejectAsset`, which now reads `placementId`).

Add the spec's second warning — a publisher retracting their placement when the
article runs elsewhere too should see that their veto is scoped to this one
placement, not the whole article. Insert it right after the `h4`/`vetoTitle`
heading, before the reason textarea:

```tsx
{(line.articlePlacement?.article._count.placements ?? 0) > 1 ? (
  <p className="muted small">
    {tp("vetoSharedWarning", { count: (line.articlePlacement!.article._count.placements - 1) })}
  </p>
) : null}
```

The trailing retracted-note branch:
```tsx
) : line.article?.versions[0]?.status === "RETRACTED" ? (
  <p className="muted small">
    <strong>{tp("retractedLabel")}:</strong>{" "}
    {line.article.versions[0].retractionNote ?? ""}
  </p>
) : null}
```
becomes:
```tsx
) : line.articlePlacement?.retractedAt ? (
  <p className="muted small">
    <strong>{tp("retractedLabel")}:</strong>{" "}
    {line.articlePlacement.retractionNote ?? ""}
  </p>
) : null}
```

- [ ] **Step 2b: `src/lib/cancellation.ts` and its test**

Read `src/lib/cancellation.ts` in full. `canRetractAsset(status: ContentAssetStatus)`
currently returns `status !== "RETRACTED"`. Since `RETRACTED` no longer exists on
`ContentAssetStatus` (Task 1), this function's signature is now meaningless for its
original purpose — Step 2 above already stopped calling it for the
retraction-eligibility check (replaced by `!line.articlePlacement.retractedAt`).
Delete `canRetractAsset` from `src/lib/cancellation.ts` entirely (grep
`src/` for any other caller first — Task 7's `publisher-actions.ts` also called
it and was already changed to read `placement.retractedAt` directly in Task 7,
so by this point in the plan there should be zero remaining callers). Delete the
`canRetractAsset` tests from `src/lib/cancellation.test.ts` (the two tests named
in the file, confirmed by the earlier grep: "allows every non-retracted draft
state" and "refuses an already-retracted asset").

- [ ] **Step 3: `src/app/[locale]/desk/orders/[orderId]/page.tsx`**

Read the current file. It has one line: `brief: { include: { assets: {...} } }`
was already fixed to `brief: true` alongside a new `article: {...}` sibling by an
earlier plan's Task 14 — confirm by reading the current query. Change that
`article: { include: { versions: {...} } }` sibling to
`articlePlacement: { include: { article: { include: { versions: {...} } } } }`.
This file only builds the query; `lines-section.tsx`/`campaign-section.tsx`
(Steps 4-5) consume the result and declare its own type literals — update those
to match.

- [ ] **Step 4: `src/app/[locale]/desk/orders/[orderId]/lines-section.tsx`**

Read the current file. Its `OrderForLines` type's `article: { include: { versions:
{...} } };` becomes `articlePlacement: { include: { article: { include: { versions:
{...} } } } };`. The read site `const assets = line.article?.versions ?? [];`
becomes `const assets = line.articlePlacement?.article.versions ?? [];`. The
`line.brief.audience`/`.message` reads stay exactly as they are — `brief` is
untouched by this plan.

This file also renders the desk's compose-draft form (the one Task 9's C1 finding
from the prior plan's final review fixed to call `saveLineDraft`) — confirm its
hidden fields still match `saveLineDraft`'s current signature (`orderLineId`,
`body`, `sourceAssetId` optionally) — Task 5 did not change `saveLineDraft`'s
form-field contract, only its internals, so this form should need no changes
beyond the type/read-site fix above. Read it to confirm rather than assume.

- [ ] **Step 5: `src/app/[locale]/desk/orders/[orderId]/campaign-section.tsx`**

Read the current file. Its two `Prisma...GetPayload` type literals (`LineWithBooking`
nested inside `OrderForCampaign`) each declare `article: { include: { versions: {
orderBy: { version: "desc" } } } };` with nothing else under `article` — replace
both with `articlePlacement: { include: { article: { include: { versions: {
orderBy: { version: "desc" } } } } } };`. Grep this file for any runtime
`.article.` read (there should be none per the earlier plan's research — confirm)
and update any found to go through `.articlePlacement?.article.` instead.

- [ ] **Step 6: `src/app/[locale]/requests/[id]/_components/types.ts`**

Read the current file. `QuoteWithOrder`'s nested `brief: { ... }` — wait, this file
was already fixed to use `article` not `brief` by the earlier plan; confirm by
reading. Its `article: { include: { versions: { orderBy: "desc"; take: 1 } } };`
becomes `articlePlacement: { include: { article: { include: { versions: {
orderBy: "desc"; take: 1 } } } } };`.

- [ ] **Step 7: `src/app/[locale]/requests/[id]/_components/OrderSection.tsx`**

Read the current file. `const asset = line.article?.versions[0];` becomes
`const asset = line.articlePlacement?.article.versions[0];`.

- [ ] **Step 8: `src/app/[locale]/requests/[id]/page.tsx`**

Read the current file. Its query's nested `article: { include: { versions: {...}
} }` (inside `quotes.order.lines`) becomes `articlePlacement: { include: {
article: { include: { versions: {...} } } } }`, matching Step 6's type change.
`request.briefSummary` (an unrelated `Request` field) stays untouched.

- [ ] **Step 9: `src/app/[locale]/writer/page.tsx`**

Read the current file. Its query's `article: { select: { versions: {...} } }`
sibling to `brief: { select: { message: true } }` becomes `articlePlacement: {
select: { article: { select: { versions: {...} } } } }`. The read site
`line.article?.versions[0]?.status ?? "NOT STARTED"` becomes
`line.articlePlacement?.article.versions[0]?.status ?? "NOT STARTED"`.

- [ ] **Step 10: `src/lib/writers/roster.ts`**

Read the current file. Its `assignedLines: { select: { article: { select: {
versions: {...} } } } }` becomes `assignedLines: { select: { articlePlacement: {
select: { article: { select: { versions: {...} } } } } } }`. The read site
`isAssignmentActive(line.article?.versions[0]?.status ?? null)` becomes
`isAssignmentActive(line.articlePlacement?.article.versions[0]?.status ?? null)`.

- [ ] **Step 11: `src/app/api/export/me/route.ts`**

Read the current file. Its `lines: { include: { brief: true, article: { include:
{ versions: true } }, booking: true } }` becomes `lines: { include: { brief: true,
articlePlacement: { include: { article: { include: { versions: true } } } },
booking: true } }`. No other change — the response flows through as-is via
`NextResponse.json`.

- [ ] **Step 11b: `src/lib/writers/access.ts` and `access.test.ts`**

Found during Task 1's review: `isAssignmentActive` still compares to the literal
`"RETRACTED"`, which no longer exists on `ContentAssetStatus` after Task 1 (it's
a compile error, not a silent bug — but fix it here rather than leaving it for
someone to trip over). Read the current file. Change:
```ts
export function isAssignmentActive(
  latestAssetStatus: ContentAssetStatus | null,
): boolean {
  return latestAssetStatus !== "FINAL" && latestAssetStatus !== "RETRACTED";
}
```
to:
```ts
export function isAssignmentActive(
  latestAssetStatus: ContentAssetStatus | null,
): boolean {
  return latestAssetStatus !== "FINAL";
}
```
(Retraction is no longer a `ContentAssetStatus` value at all — it lives on
`ArticlePlacement.retractedAt` now, per Task 1/7. "Active" here only ever meant
"the writer still owes work on this," which `FINAL` alone already captures
correctly; a retracted placement doesn't change whether the underlying writing
is done.)

In `src/lib/writers/access.test.ts`, remove the now-invalid assertion
`assert.equal(isAssignmentActive("RETRACTED"), false);` — `"RETRACTED"` is not a
valid `ContentAssetStatus` value anymore, so this line won't compile. Leave the
other four assertions in that test (`null`, `"DRAFT"`, `"IN_REVIEW"`, `"FINAL"`)
unchanged — they still hold under the new implementation.

- [ ] **Step 12: Confirm no file was missed**

Run: `pnpm typecheck 2>&1 | grep -B2 "error TS" | grep "\.tsx\?:" | sed -E 's/\(.*//' | sort -u`
Expected: this should list only files not yet touched by this plan (Tasks 10-15
below) — none of the 11 files in this task should remain.

- [ ] **Step 13: Run the full unit suite**

Run: `pnpm test`
Expected: same pass count as before this task (behavior-preserving renames, plus
`canRetractAsset`'s two tests removed — confirm the total count drops by exactly 2
from whatever the pre-task baseline was, and nothing else changes).

- [ ] **Step 14: Commit**

```bash
git add "src/app/[locale]/orders/[orderId]/page.tsx" "src/app/[locale]/publisher/orders/page.tsx" "src/app/[locale]/desk/orders/[orderId]/page.tsx" "src/app/[locale]/desk/orders/[orderId]/lines-section.tsx" "src/app/[locale]/desk/orders/[orderId]/campaign-section.tsx" "src/app/[locale]/requests/[id]/page.tsx" "src/app/[locale]/requests/[id]/_components/OrderSection.tsx" "src/app/[locale]/requests/[id]/_components/types.ts" "src/app/[locale]/writer/page.tsx" src/lib/writers/roster.ts src/app/api/export/me/route.ts src/lib/cancellation.ts src/lib/cancellation.test.ts src/lib/writers/access.ts src/lib/writers/access.test.ts
git commit -m "fix(content): repoint remaining OrderLine.article reads at ArticlePlacement"
```

---

### Task 10: Overview page — placement column becomes a list

**Files:**
- Modify: `src/app/[locale]/articles/page.tsx`

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Rewrite the query and placement column**

Read the current file (quoted in full in this plan's research — reproduced here
for the exact starting point). Change the `articles` query: replace

```ts
include: {
  versions: { orderBy: { version: "desc" }, take: 1, select: { status: true } },
  orderLine: {
    select: {
      orderId: true,
      productId: true,
    },
  },
},
```

with

```ts
include: {
  versions: { orderBy: { version: "desc" }, take: 1, select: { status: true } },
  placements: {
    select: {
      orderLine: {
        select: {
          orderId: true,
          productId: true,
        },
      },
    },
  },
},
```

Change the product-name batch fetch: `articles.map((a) => a.orderLine?.productId)`
becomes `articles.flatMap((a) => a.placements.map((p) => p.orderLine.productId))`
(still filtered to non-null and deduped exactly as before).

Replace the placement cell. Today it renders one link or a "not linked" badge;
now it renders a list of links (or the same badge when the list is empty):

```tsx
<td data-label={t("colPlacement")}>
  {a.placements.length > 0 ? (
    <ul className="cluster tight list-none p-0">
      {a.placements.map((p, i) => (
        <li key={i}>
          <Link href={`/orders/${p.orderLine.orderId}`}>
            {p.orderLine.productId
              ? (titleByProductId.get(p.orderLine.productId) ?? t("colPlacement"))
              : t("colPlacement")}
          </Link>
        </li>
      ))}
    </ul>
  ) : (
    <span className="badge badge-neutral">{t("notLinked")}</span>
  )}
</td>
```

(`ArticlePlacement` has no own `id` selected above since it isn't needed for this
read-only list — leave the `select` as shown, don't add fields this page doesn't
use.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "articles/page"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/articles/page.tsx"
git commit -m "feat(content): show every linked placement on the articles overview"
```

---

### Task 11: Detail page — repeatable placements, sibling-edit warning

**Files:**
- Modify: `src/app/[locale]/articles/[articleId]/page.tsx`

**Interfaces:**
- Consumes: `unlinkArticleFromOrderLine` (Task 4), `resolveEffectiveAsset` (Task 2),
  `runSpecCheck` (Task 5, now `placementId`-keyed).

- [ ] **Step 1: Rewrite the query**

Read the current file directly — it is not reproduced in full in this plan
document, only the specific transformations below. Replace the `article`
query's `orderLineId`/`orderLine` fields with a `placements` list, and resolve the
effective asset via the helper instead of always reading `versions[0]`:

```ts
const article = await prisma.article.findUnique({
  where: { id: articleId },
  select: {
    id: true,
    title: true,
    organizationId: true,
    placements: {
      select: {
        id: true,
        lockedAssetId: true,
        specPassed: true,
        specNotes: true,
        retractedAt: true,
        orderLine: { select: { orderId: true, productId: true } },
      },
    },
    versions: {
      orderBy: { version: "desc" },
      take: 1,
      select: { id: true, status: true, body: true, bodyUrl: true, reviewNotes: true },
    },
  },
});
if (!article) redirect(`/${locale}/articles`);

// The article's own latest version — what the write/upload forms edit and
// what a newly-linked placement would start from. Individual placements
// may instead be showing an older, locked version (see below).
const latestArticleVersion = article.versions[0];

const downloadUrl = latestArticleVersion?.bodyUrl
  ? await presignDownloadOrNull({ key: latestArticleVersion.bodyUrl })
  : null;

// Resolve each placement's own effective asset (locked version if it has
// one, otherwise the article's latest) and its title/product name.
const placementProductIds = article.placements
  .map((p) => p.orderLine.productId)
  .filter((id): id is string => !!id);
const placementProducts = placementProductIds.length
  ? await prisma.product.findMany({
      where: { id: { in: placementProductIds } },
      select: { id: true, title: { select: { name: true } } },
    })
  : [];
const titleByProductId = new Map(placementProducts.map((p) => [p.id, p.title.name]));
const placementsWithAsset = await Promise.all(
  article.placements.map(async (p) => ({
    ...p,
    effectiveAsset: await resolveEffectiveAsset({ articleId: article.id, lockedAssetId: p.lockedAssetId }),
    label: p.orderLine.productId
      ? (titleByProductId.get(p.orderLine.productId) ?? t("colPlacement"))
      : t("colPlacement"),
  })),
);

const eligibleLines = await prisma.orderLine.findMany({
  where: {
    kind: "INVENTORY",
    articlePlacement: null,
    order: { organizationId: article.organizationId },
  },
  select: { id: true, productId: true },
});
const eligibleProductIds = eligibleLines.map((l) => l.productId).filter((id): id is string => !!id);
const eligibleProducts = eligibleProductIds.length
  ? await prisma.product.findMany({
      where: { id: { in: eligibleProductIds } },
      select: { id: true, title: { select: { name: true } } },
    })
  : [];
const titleByEligibleProductId = new Map(eligibleProducts.map((p) => [p.id, p.title.name]));
```

(`eligibleLines` is no longer conditional on `article.orderLineId` being null —
since there's no cap on placements, the link form always renders, listing lines
not yet claimed by ANY article.)

- [ ] **Step 2: Rewrite the placements section**

Replace the single linked-placement paragraph / single link form with a list plus
a per-item unlink button, and keep the "link another" form always available:

```tsx
<section className="space-y-2 rounded border p-4">
  <h2 className="text-sm font-semibold">{t("linkHeading")}</h2>
  {placementsWithAsset.length > 0 ? (
    <ul className="space-y-1 text-sm">
      {placementsWithAsset.map((p) => (
        <li key={p.id} className="flex items-center gap-2">
          <a href={`/${locale}/orders/${p.orderLine.orderId}`} className="underline">
            {p.label}
          </a>
          {p.retractedAt ? (
            <span className="badge badge-error dotless">{t("placementRetracted")}</span>
          ) : null}
          <form action={unlinkArticleFromOrderLine}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="articleId" value={articleId} />
            <input type="hidden" name="placementId" value={p.id} />
            <button type="submit" className="text-xs underline text-gray-500">
              {t("unlinkCta")}
            </button>
          </form>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-gray-500">{t("linkHint")}</p>
  )}
  {eligibleLines.length === 0 ? (
    placementsWithAsset.length === 0 ? <p className="text-xs text-gray-500">{t("linkEmpty")}</p> : null
  ) : (
    <form action={linkArticleToOrderLine} className="flex items-center gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="articleId" value={articleId} />
      <select name="orderLineId" className="rounded border p-2 text-sm">
        {eligibleLines.map((l) => (
          <option key={l.id} value={l.id}>
            {l.productId ? (titleByEligibleProductId.get(l.productId) ?? l.id) : l.id}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white">
        {t("linkCta")}
      </button>
    </form>
  )}
</section>
```

Import `unlinkArticleFromOrderLine` alongside the existing `linkArticleToOrderLine`
import from `@/app/article-library-actions`.

- [ ] **Step 3: Replace the rest of the page body with the exact block below**

Everything from the sibling-placement warning through the buyer-review section
replaces the original file's write form / `UploadForm` / download link / status
line / spec-check form / submit-for-review form / review-notes paragraph /
approve-reject section as ONE block — the original single "run spec check" form
(keyed by `assetId`) is deleted entirely here, not renamed; its replacement is
the new per-placement spec-check list, placed BEFORE the write form instead of
after (so a placement's spec status is visible before you start editing shared
text that affects it):

```tsx
{placementsWithAsset.length > 0 ? (
  <div className="space-y-2">
    {placementsWithAsset.map((p) =>
      p.effectiveAsset ? (
        <div key={`spec-${p.id}`} className="flex items-center gap-3 text-sm">
          <span>
            {p.label}:
            {p.specPassed === true
              ? ` ${t("detailSpecPassed")}`
              : p.specPassed === false
                ? ` ${t("detailSpecFailed")}`
                : ` ${t("specNotChecked")}`}
          </span>
          <form action={runSpecCheck}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="placementId" value={p.id} />
            <button type="submit" className="underline">
              {t("detailRunSpecCheck")}
            </button>
          </form>
        </div>
      ) : null,
    )}
  </div>
) : null}

{placementsWithAsset.length > 1 ? (
  <p className="text-xs text-amber-700">
    {t("sharedArticleWarning", { count: placementsWithAsset.length })}
  </p>
) : null}

<form action={saveDraft} className="space-y-2">
  <input type="hidden" name="locale" value={locale} />
  <input type="hidden" name="articleId" value={articleId} />
  <label className="block text-sm font-medium">{t("detailWriteHeading")}</label>
  <textarea
    name="body"
    defaultValue={latestArticleVersion?.bodyUrl ? "" : (latestArticleVersion?.body ?? "")}
    rows={18}
    className="w-full rounded border p-2 font-mono text-sm"
  />
  <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white">
    {t("detailSaveDraft")}
  </button>
</form>

<UploadForm
  articleId={articleId}
  locale={locale}
  saveDraftAction={saveUploadedDraft}
  labels={{
    heading: t("detailUploadHeading"),
    hint: t("detailUploadHint"),
    uploading: t("detailUploading"),
    save: t("detailSaveDraft"),
  }}
/>

{downloadUrl ? (
  <p className="text-sm">
    <a href={downloadUrl} target="_blank" rel="noreferrer noopener" className="underline">
      {t("detailDownloadFile")} ↗
    </a>
  </p>
) : null}

{latestArticleVersion ? (
  <div className="flex items-center gap-4 text-sm">
    <span>
      {t("detailStatus")}: <StatusBadge value={latestArticleVersion.status} />
    </span>
    <form action={setAssetStatus}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="assetId" value={latestArticleVersion.id} />
      <input type="hidden" name="target" value="IN_REVIEW" />
      <button type="submit" className="underline">
        {t("detailSubmitForReview")}
      </button>
    </form>
  </div>
) : null}

{latestArticleVersion?.reviewNotes ? (
  <p className="text-sm text-amber-700">
    {t("detailReviewNotes")}: {latestArticleVersion.reviewNotes}
  </p>
) : null}

{latestArticleVersion?.status === "IN_REVIEW" && canActOnOrg(scope, article.organizationId) ? (
  <section className="space-y-2 rounded border p-4">
    <h2 className="text-sm font-semibold">{tOrders("draftReviewHeading")}</h2>
    <div className="flex items-center gap-3">
      <form action={approveContentAsset}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="assetId" value={latestArticleVersion.id} />
        <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white">
          {tOrders("draftApprove")}
        </button>
      </form>
      <form action={requestContentChanges} className="flex items-center gap-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="assetId" value={latestArticleVersion.id} />
        <input
          type="text"
          name="note"
          placeholder={tOrders("draftChangesPlaceholder")}
          className="rounded border p-2 text-sm"
        />
        <button type="submit" className="rounded border px-3 py-1.5 text-sm">
          {tOrders("draftSendChanges")}
        </button>
      </form>
    </div>
  </section>
) : null}
```

Note what changed from the original file, spelled out so the transformation is
unambiguous: the shared status line no longer shows `specPassed` (that's now
shown per placement, in the block above the write form); the old
`assetId`-keyed "run spec check" form is gone, replaced by the per-placement
list; `approveContentAsset`/`requestContentChanges` do NOT get an `orderId`
hidden field here (Task 6 made it an optional hint — this page has no single
order to hint at, matching Task 6's design); every other field/form is
unchanged from the original file, just reading `latestArticleVersion` instead of
`latest`. `t("linkCta")` and `unlinkArticleFromOrderLine` come from Step 2 above,
already in scope in the same component.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "articles/\[articleId\]"`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/articles/[articleId]/page.tsx"
git commit -m "feat(content): repeatable placement linking and per-placement spec check"
```

---

### Task 12: Home page — simplify routing, drop wave-angle text

**Files:**
- Modify: `src/app/[locale]/home/page.tsx`

**Interfaces:**
- Consumes: nothing new (this task only touches display logic already present).

- [ ] **Step 1: Simplify `pendingContent`**

Read the current file. The `pendingContent` query already filters
`article: { organizationId: { in: orgIds } } }` (a fix from an earlier plan) — this
stays correct unchanged (still filtering on the shared `Article.organizationId`,
untouched by this plan). Simplify what it selects and how the card links, since
"which one of possibly several placements" no longer has a single answer:

Replace:
```ts
select: {
  id: true,
  article: {
    select: {
      id: true,
      orderLine: {
        select: { order: { select: { id: true } }, booking: { select: { title: { select: { name: true } } } } },
      },
    },
  },
},
```
with:
```ts
select: {
  id: true,
  article: { select: { id: true } },
},
```
Replace the render:
```ts
const orderId = c.article.orderLine?.order.id ?? null;
const titleName = c.article.orderLine?.booking?.title?.name ?? "";
const draftHref = orderId ? `/orders/${orderId}` : `/articles/${c.article.id}`;
```
with:
```ts
const draftHref = `/articles/${c.article.id}`;
```
and remove the `titleName` badge from the card JSX (the `{titleName ? (<span
className="badge badge-success dotless">{titleName}</span>) : null}` block) —
there's no longer a single title to show on a card that might represent an
article linked to several.

- [ ] **Step 2: Drop `articleAngle` from the due-wave nudge card**

Find the due-wave rendering block (`dueWaves.map(...)`), specifically the line:
```tsx
{w.articleAngle ? <> {t("nextWaveAngle", { angle: w.articleAngle })}</> : null}
```
`DueWave.articleAngle` becomes `DueWave.articleTitle` in Task 13's rewrite of
`programme.ts` — update this line to:
```tsx
{w.articleTitle ? <> {t("nextWaveAngle", { angle: w.articleTitle })}</> : null}
```
(Reuse the existing `nextWaveAngle` translation key and its `{angle}` placeholder
name — only the underlying data source changes, not the copy shown to the user.)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "home/page"`
Expected: errors here are expected until Task 13 renames `DueWave.articleAngle` —
if doing these tasks in plan order, this file's `w.articleTitle` reference will
error until then; that's fine, confirm no OTHER unrelated errors appear in this
file.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/home/page.tsx"
git commit -m "feat(content): simplify pendingContent routing for multi-placement articles"
```

---

### Task 13: `programme.ts` + `programme-actions.ts` — angle becomes article

**Files:**
- Modify: `src/lib/programme.ts`
- Modify: `src/app/programme-actions.ts`

**Interfaces:**
- Consumes: `createArticle` (unchanged, `@/app/article-library-actions`).
- Produces: `ProgrammeView.waves[].articleId`/`articleTitle` (replacing
  `articleAngle`), `DueWave.articleId`/`articleTitle` (replacing `articleAngle`),
  `withWaveAngle(brief, list)` (same signature, new source), new actions
  `linkWaveArticle`/`unlinkWaveArticle` (replacing `updateWaveAngle`). Consumed by
  Task 12 (home page, already updated) and Task 14 (`PlanProgramme.tsx`).

- [ ] **Step 1: Update `copyListForNewWave` and `createProgramme`**

In `src/lib/programme.ts`, `copyListForNewWave`'s `opts` type: replace
`articleAngle?: string | null;` with nothing (drop the option entirely — a copied
wave starts with NO linked article; the buyer creates or links one per wave from
`PlanProgramme.tsx`, it's never copied/pre-filled from the source list). Remove
the `articleAngle: opts.articleAngle ?? null,` line from the `tx.savedList.create`
call.

In `createProgramme`, remove the `angle`/`angles` handling entirely: delete the
`angle` closure (`const angle = (k: number) => {...}`), remove `angles:
Array<string | null>;` from the function's `input` type, remove
`articleAngle: angle(0)` from the `tx.savedList.update` call for wave 1, and
remove `articleAngle: angle(k - 1)` from the `copyListForNewWave` call for waves
2..N (matching the option removal above).

- [ ] **Step 2: Update `ProgrammeView`/`DueWave` types and their builders**

Replace `articleAngle: string | null;` with `articleId: string | null; articleTitle:
string | null;` in both the `ProgrammeView["waves"]` element type and `DueWave`.

`WAVE_STATE_INCLUDE` needs the article's title alongside what it already selects:
```ts
const WAVE_STATE_INCLUDE = {
  items: { select: { scheduleStart: true } },
  article: { select: { id: true, title: true } },
  requests: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: {
      id: true,
      status: true,
      quotes: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: { status: true, order: { select: { id: true, status: true } } },
      },
    },
  },
} satisfies Prisma.SavedListInclude;
```
In `toView`'s `.map(...)`, replace `articleAngle: w.articleAngle,` with
`articleId: w.article?.id ?? null, articleTitle: w.article?.title ?? null,`.

In `dueWaveFromView`, replace `articleAngle: w.articleAngle,` (in the returned
`DueWave` object) with `articleId: w.articleId, articleTitle: w.articleTitle,`.

- [ ] **Step 3: Remove `setWaveAngle`, add `linkWaveArticle`/`unlinkWaveArticle`**

Delete `setWaveAngle` entirely. Add:

```ts
export async function linkWaveArticle(listId: string, articleId: string): Promise<void> {
  await prisma.savedList.updateMany({
    where: { id: listId },
    data: { articleId },
  });
}

export async function unlinkWaveArticle(listId: string): Promise<void> {
  await prisma.savedList.updateMany({
    where: { id: listId },
    data: { articleId: null },
  });
}
```

- [ ] **Step 4: Update `withWaveAngle`**

```ts
export async function withWaveAngle(
  brief: string,
  list: { programmeId: string | null; waveNumber: number | null; articleTitle: string | null },
): Promise<string> {
  if (!list.programmeId || !list.waveNumber) return brief;
  const programme = await prisma.campaignProgramme.findUnique({
    where: { id: list.programmeId },
    select: { plannedWaves: true },
  });
  const of = programme?.plannedWaves ?? list.waveNumber;
  const angle = list.articleTitle?.trim() || "(not set — no article linked for this wave)";
  const line = `Article angle (wave ${list.waveNumber} of ${of}): ${angle}`;
  return brief ? `${line}\n${brief}` : line;
}
```

Grep every call site of `withWaveAngle` (`src/lib/commerce/submit-rfq.ts`,
`src/app/checkout-actions.ts`, per the design spec) and confirm the object passed
now has `articleTitle` (a `SavedList.article?.title` lookup at the call site) —
read each caller and adjust the `select`/data shape it passes in, mirroring
whatever it previously did for `articleAngle`.

- [ ] **Step 5: `programme-actions.ts` — replace `updateWaveAngle`**

```ts
import {
  createProgramme,
  dissolveProgramme as dissolveProgrammeLists,
  linkWaveArticle,
  unlinkWaveArticle,
  ProgrammeError,
} from "@/lib/programme";
import { createArticle } from "@/app/article-library-actions";
```

Replace `updateWaveAngle` with two actions:

```ts
// Link an existing (unlinked-elsewhere-or-not) article to this wave —
// reuses the same organization-scoped article picker flow, not a new one.
export async function linkWaveArticleAction(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const articleId = str(formData, "articleId");
  const { scope, list } = await ownList(locale, listId);
  await linkWaveArticle(list.id, articleId);
  await recordAudit(scope.userId ?? null, "programme.wave_article_link", `SavedList:${list.id}`, { articleId });
  redirect(`/${locale}/plan`);
}

export async function unlinkWaveArticleAction(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const { scope, list } = await ownList(locale, listId);
  await unlinkWaveArticle(list.id);
  await recordAudit(scope.userId ?? null, "programme.wave_article_unlink", `SavedList:${list.id}`);
  redirect(`/${locale}/plan`);
}
```

(`createArticle` is imported here for `PlanProgramme.tsx`/Task 14 to post directly
to — this file doesn't need its own wrapper for creation, only for link/unlink,
since `createArticle` already redirects to `/articles/${article.id}` on success,
not back to `/plan`. Task 14's "create" entry point sends the buyer to the new
article's own page to write/upload, then they come back to `/plan` and link it —
covered in Task 14's design below.)

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "programme"`
Expected: errors remain in `PlanProgramme.tsx` (Task 14) and `home/page.tsx`
(already updated in Task 12, should now be clean) — confirm no OTHER files error.

- [ ] **Step 7: Commit**

```bash
git add src/lib/programme.ts src/app/programme-actions.ts
git commit -m "feat(programme): replace free-text article angle with real article linking"
```

---

### Task 14: `PlanProgramme.tsx` — UI swap

**Files:**
- Modify: `src/app/[locale]/plan/_components/PlanProgramme.tsx`

**Interfaces:**
- Consumes: `linkWaveArticleAction`, `unlinkWaveArticleAction` (Task 13),
  `createArticle` (`@/app/article-library-actions`, unchanged).

- [ ] **Step 1: Update imports and the wave-strip angle display**

Replace `import { updateWaveAngle, dissolveProgramme } from "@/app/programme-actions";`
with `import { linkWaveArticleAction, unlinkWaveArticleAction, dissolveProgramme } from "@/app/programme-actions";`.

The wave-strip chip (`{w.articleAngle ? <span className="wave-strip__angle">{w.articleAngle}</span> : null}`)
becomes `{w.articleTitle ? <span className="wave-strip__angle">{w.articleTitle}</span> : null}`
(matching `ProgrammeView`'s renamed field from Task 13).

- [ ] **Step 2: Replace the angle-edit form**

The spec's reuse requirement ("an article can be linked to multiple
campaigns/waves") means this form must support linking an **existing** article
to a wave, not only creating a new one each time — otherwise nothing in the UI
actually exercises the many-waves-per-article capability Task 1-4 built. This
component is already an async Server Component (`export async function
PlanProgramme(...)`), so it fetches the small bit of data it needs itself rather
than growing its prop list.

Replace the `{current ? (<form action={updateWaveAngle} ...>...</form>) : null}`
block with:

```tsx
{current ? (
  <div className="plan-programme__angle-form">
    {current.articleId ? (
      <div className="plan-programme__angle-row">
        <a href={`/${locale}/articles/${current.articleId}`} className="link">
          {current.articleTitle ?? t("viewArticle")}
        </a>
        <form action={unlinkWaveArticleAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="listId" value={listId} />
          <button type="submit" className="btn small secondary">
            {t("unlinkArticle")}
          </button>
        </form>
      </div>
    ) : (
      <div className="plan-programme__angle-row">
        {otherArticles.length > 0 ? (
          <form action={linkWaveArticleAction} className="plan-programme__angle-row">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="listId" value={listId} />
            <select name="articleId">
              {otherArticles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
            <button type="submit" className="btn small secondary">
              {tArticles("linkCta")}
            </button>
          </form>
        ) : null}
        <form action={createAndLinkWaveArticle} className="plan-programme__angle-row">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="listId" value={listId} />
          <input type="text" name="title" placeholder={t("anglePlaceholder")} required />
          <button type="submit" className="btn small secondary">
            {t("createArticleForWave")}
          </button>
        </form>
      </div>
    )}
    <p className="muted small">{t("angleHint")}</p>
  </div>
) : null}
```

Add a second `getTranslations` call near the top of the component, alongside the
existing `t = await getTranslations({ locale, namespace: "plan.programme" })`:
`const tArticles = await getTranslations({ locale, namespace: "articles" });` —
the `articles` namespace already has a `linkCta` key ("Link") from the
article-library plan, reused here for the "link existing article" button rather
than adding a duplicate key with the same meaning. This mirrors the existing
cross-namespace pattern already used elsewhere in this codebase (e.g.
`articles/[articleId]/page.tsx`'s `tOrders`).

Fetch `otherArticles` near the top of the component, only when there's a current
wave with no article yet (no need to query when a wave already has one, or when
`view` is null / this is the plain-list disclosure state):

```ts
const otherArticles =
  current && !current.articleId
    ? await (async () => {
        const list = await prisma.savedList.findUnique({
          where: { id: listId },
          select: { organizationId: true },
        });
        if (!list) return [];
        return prisma.article.findMany({
          where: { organizationId: list.organizationId },
          orderBy: { updatedAt: "desc" },
          take: 20,
          select: { id: true, title: true },
        });
      })()
    : [];
```

Import `prisma` from `@/lib/prisma` at the top of the file alongside the existing
imports.

`createAndLinkWaveArticle` (new, add to `src/app/programme-actions.ts` in Task
13's Step 5 alongside `linkWaveArticleAction`/`unlinkWaveArticleAction` — not a
separate task, fold it into Task 13):

```ts
// Add to Task 13's programme-actions.ts, alongside linkWaveArticleAction/unlinkWaveArticleAction.
export async function createAndLinkWaveArticle(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const title = str(formData, "title");
  const { scope, list } = await ownList(locale, listId);
  if (!title) redirect(`/${locale}/plan`);
  const article = await prisma.article.create({
    data: {
      organizationId: list.organizationId,
      title,
      createdByUserId: scope.userId ?? "",
      createdByRole: (scope.role as UserRole) ?? "BUYER",
    },
  });
  await linkWaveArticle(list.id, article.id);
  await recordAudit(scope.userId ?? null, "programme.wave_article_create", `SavedList:${list.id}`, { articleId: article.id });
  redirect(`/${locale}/articles/${article.id}`);
}
```

(This duplicates a few lines of `createArticle`'s body rather than composing it,
because `createArticle` redirects internally — Server Actions can't easily chain
one action's mutation without its redirect firing first. Accept the small
duplication here; it's three fields, not worth restructuring `createArticle` to
support an injectable post-create hook for one caller.) `linkWaveArticleAction`
(already defined in Task 13 Step 5) is used as-is for the "link existing" form
above — no changes needed to it.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "PlanProgramme\|programme-actions"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/plan/_components/PlanProgramme.tsx" src/app/programme-actions.ts
git commit -m "feat(programme): wave article create/link/unlink UI"
```

---

### Task 15: Locale copy

**Files:**
- Modify: `src/messages/en.json`, `no.json`, `da.json`, `sv.json`, `fi.json`, `de.json`

**Interfaces:**
- Produces: four new `articles` namespace keys, four new `plan.programme` keys,
  two removed `plan.programme` keys — consumed by Tasks 11 and 14.

- [ ] **Step 1: Add to the `articles` namespace in all six files**

English (`en.json`):
```json
"placementRetracted": "Retracted",
"unlinkCta": "Unlink",
"sharedArticleWarning": "This article is linked to {count} other placements — your changes will affect all of them.",
"specNotChecked": "not checked"
```

Norwegian (`no.json`):
```json
"placementRetracted": "Trukket tilbake",
"unlinkCta": "Fjern kobling",
"sharedArticleWarning": "Denne artikkelen er koblet til {count} andre plasseringer — endringene dine påvirker alle.",
"specNotChecked": "ikke sjekket"
```

Danish (`da.json`):
```json
"placementRetracted": "Trukket tilbage",
"unlinkCta": "Fjern kobling",
"sharedArticleWarning": "Denne artikel er koblet til {count} andre placeringer — dine ændringer påvirker dem alle.",
"specNotChecked": "ikke tjekket"
```

Swedish (`sv.json`):
```json
"placementRetracted": "Indragen",
"unlinkCta": "Ta bort koppling",
"sharedArticleWarning": "Den här artikeln är kopplad till {count} andra placeringar — dina ändringar påverkar alla.",
"specNotChecked": "inte kontrollerad"
```

Finnish (`fi.json`):
```json
"placementRetracted": "Peruutettu",
"unlinkCta": "Poista linkitys",
"sharedArticleWarning": "Tämä artikkeli on linkitetty {count} muuhun sijoitteluun — muutoksesi vaikuttavat kaikkiin.",
"specNotChecked": "ei tarkistettu"
```

German (`de.json`):
```json
"placementRetracted": "Zurückgezogen",
"unlinkCta": "Verknüpfung entfernen",
"sharedArticleWarning": "Dieser Artikel ist mit {count} weiteren Platzierungen verknüpft — deine Änderungen wirken sich auf alle aus.",
"specNotChecked": "nicht geprüft"
```

- [ ] **Step 1b: Add one key to the `production` namespace in all six files**

This is the spec's second warning — shown on the publisher's veto confirmation
when the article they're about to retract also runs on other placements (Task 9
Step 2 uses it via `tp("vetoSharedWarning", { count })`).

English (`en.json`): `"vetoSharedWarning": "This article also runs on {count} other placement(s) — they will not be affected by this retraction."`

Norwegian (`no.json`): `"vetoSharedWarning": "Denne artikkelen kjører også på {count} andre plassering(er) — de påvirkes ikke av denne tilbaketrekningen."`

Danish (`da.json`): `"vetoSharedWarning": "Denne artikel kører også på {count} andre placering(er) — de påvirkes ikke af denne tilbagetrækning."`

Swedish (`sv.json`): `"vetoSharedWarning": "Den här artikeln körs också på {count} andra placering(ar) — de påverkas inte av den här indragningen."`

Finnish (`fi.json`): `"vetoSharedWarning": "Tämä artikkeli on käytössä myös {count} muussa sijoittelussa — tämä peruutus ei vaikuta niihin."`

German (`de.json`): `"vetoSharedWarning": "Dieser Artikel läuft auch auf {count} weiteren Platzierungen — sie sind von diesem Widerruf nicht betroffen."`

- [ ] **Step 2: Update the `plan.programme` namespace in all six files**

Remove the `angleEdit` and `angleSave` keys (no longer referenced —
`PlanProgramme.tsx` no longer renders a free-text angle input, per Task 14).
Keep `anglePlaceholder` and `angleHint` — both are still used (as the create-article
title input's placeholder, and as the trailing hint line, respectively).

Add these four keys to each locale:

English (`en.json`):
```json
"viewArticle": "View article",
"unlinkArticle": "Unlink",
"noArticleYet": "No article linked to this wave yet.",
"createArticleForWave": "Create article"
```

Norwegian (`no.json`):
```json
"viewArticle": "Åpne artikkel",
"unlinkArticle": "Fjern kobling",
"noArticleYet": "Ingen artikkel koblet til denne runden ennå.",
"createArticleForWave": "Opprett artikkel"
```

Danish (`da.json`):
```json
"viewArticle": "Åbn artikel",
"unlinkArticle": "Fjern kobling",
"noArticleYet": "Ingen artikel koblet til denne runde endnu.",
"createArticleForWave": "Opret artikel"
```

Swedish (`sv.json`):
```json
"viewArticle": "Öppna artikel",
"unlinkArticle": "Ta bort koppling",
"noArticleYet": "Ingen artikel kopplad till den här omgången ännu.",
"createArticleForWave": "Skapa artikel"
```

Finnish (`fi.json`):
```json
"viewArticle": "Avaa artikkeli",
"unlinkArticle": "Poista linkitys",
"noArticleYet": "Tähän kierrokseen ei ole vielä linkitetty artikkelia.",
"createArticleForWave": "Luo artikkeli"
```

German (`de.json`):
```json
"viewArticle": "Artikel öffnen",
"unlinkArticle": "Verknüpfung entfernen",
"noArticleYet": "Diesem Wave ist noch kein Artikel zugeordnet.",
"createArticleForWave": "Artikel erstellen"
```

- [ ] **Step 3: Run the locale parity test**

Run: `pnpm exec tsx --test src/messages/locale-parity.test.ts`
Expected: PASS — every locale has the same key set, and the untranslated-leak
guard confirms no locale accidentally copied the English string verbatim where a
real translation was expected. (This is the file that actually contains the
parity/leak-guard suite — a prior plan in this codebase mis-named it
`market-labels.test.ts` in one task brief; that file only covers `MarketCode`
labels, a different, narrower test. Use `locale-parity.test.ts` here.)

- [ ] **Step 4: Commit**

```bash
git add src/messages/*.json
git commit -m "feat(i18n): add locale copy for shared articles and wave linking"
```

---

### Task 16: Integration test rewrite

**Files:**
- Modify: `src/app/article-library.it.test.ts`

**Interfaces:**
- Consumes: `ensurePlacementForLine`, `lockPlacementsOnFinal` (Task 2),
  `linkArticleToOrderLine`/`unlinkArticleFromOrderLine` (Task 4).

- [ ] **Step 1: Read the current file in full**

The current file actually has FOUR tests, not three — a fourth
("`ensureArticleForLine` is idempotent: concurrent first-writes yield one
Article") was added later, by the prior feature's own final-review fix wave, to
cover a concurrency race. Read the current file before editing.

Three assert the old 1:1 invariant directly and need rework (an unlinked
article's `orderLineId` is null; creating a second `Article` with the same
`orderLineId` must reject; the concurrent-`ensureArticleForLine` race). The
third test in the original three — `canWriteArticle`'s journalist-assignment
scenario — needs no changes at all.

**Delete the fourth test outright** (`import { ensureArticleForLine } from
"@/lib/writers/article";` at the top of the file, and the whole `test(
"ensureArticleForLine is idempotent...")` block) rather than porting it forward
— `@/lib/writers/article` no longer exists (Task 5 deleted it), and the race
condition it covered (two concurrent first-writes for the same line converging
on one row) is now fully covered by Task 2's `src/lib/writers/placement.it.test.ts`,
which tests the exact same race against `ensurePlacementForLine` (the function
that replaced `ensureArticleForLine`). Keeping both would just duplicate
coverage of the same behavior under two different function names.

- [ ] **Step 2: Replace the two invalidated tests, add two new ones**

Replace "one-article-per-placement unique constraint" (the second test, which
built a `Plan → Request → Quote → Order → OrderLine` chain and asserted a second
`Article.create` with the same `orderLineId` rejects) with a test of the NEW
invariant — `ArticlePlacement.orderLineId` is what's now unique, not
`Article.orderLineId`:

```ts
test("an order line can be linked to at most one placement (unique constraint), but one article can have many placements", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Test Org 2", type: "ADVERTISER" } });
  const user = await prisma.user.create({
    data: { email: `it-buyer2-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id },
  });
  const plan = await prisma.plan.create({ data: { organizationId: org.id, name: "IT plan" } });
  const request = await prisma.request.create({ data: { organizationId: org.id, planId: plan.id, status: "DRAFT" } });
  const quote = await prisma.quote.create({ data: { requestId: request.id, status: "ACCEPTED", currency: "EUR", subtotal: 0, vatPct: 0, total: 0 } });
  const order = await prisma.order.create({ data: { organizationId: org.id, quoteId: quote.id, status: "CONFIRMED" } });
  const lineA = await prisma.orderLine.create({ data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 } });
  const lineB = await prisma.orderLine.create({ data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 } });

  const article = await prisma.article.create({
    data: { organizationId: org.id, title: "Shared piece", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  const placementA = await prisma.articlePlacement.create({ data: { orderLineId: lineA.id, articleId: article.id } });
  // Same article, a DIFFERENT line — must succeed (this is the reuse this
  // whole plan exists to enable).
  const placementB = await prisma.articlePlacement.create({ data: { orderLineId: lineB.id, articleId: article.id } });
  assert.equal(await prisma.articlePlacement.count({ where: { articleId: article.id } }), 2);

  // A SECOND placement on the SAME line must reject.
  const otherArticle = await prisma.article.create({
    data: { organizationId: org.id, title: "Different piece", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  await assert.rejects(() =>
    prisma.articlePlacement.create({ data: { orderLineId: lineA.id, articleId: otherArticle.id } }),
  );

  await prisma.articlePlacement.deleteMany({ where: { id: { in: [placementA.id, placementB.id] } } });
  await prisma.article.deleteMany({ where: { id: { in: [article.id, otherArticle.id] } } });
  await prisma.orderLine.deleteMany({ where: { id: { in: [lineA.id, lineB.id] } } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.quote.delete({ where: { id: quote.id } });
  await prisma.request.delete({ where: { id: request.id } });
  await prisma.plan.delete({ where: { id: plan.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});
```

(Verify the exact `Plan`/`Request`/`Quote` required-field shape against the
current `prisma/schema.prisma` before running — Task 2's placement.test.ts
carries the same caveat; use whichever shape you confirmed working there.)

Add a new test for retraction independence and version locking — the two
behaviors this whole plan exists to get right:

```ts
test("retracting one placement doesn't affect a sibling placement of the same article; FINAL locks unlocked placements", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Test Org 5", type: "ADVERTISER" } });
  const user = await prisma.user.create({
    data: { email: `it-buyer5-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id },
  });
  const plan = await prisma.plan.create({ data: { organizationId: org.id, name: "IT plan 5" } });
  const request = await prisma.request.create({ data: { organizationId: org.id, planId: plan.id, status: "DRAFT" } });
  const quote = await prisma.quote.create({ data: { requestId: request.id, status: "ACCEPTED", currency: "EUR", subtotal: 0, vatPct: 0, total: 0 } });
  const order = await prisma.order.create({ data: { organizationId: org.id, quoteId: quote.id, status: "CONFIRMED" } });
  const lineA = await prisma.orderLine.create({ data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 } });
  const lineB = await prisma.orderLine.create({ data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 } });

  const article = await prisma.article.create({
    data: { organizationId: org.id, title: "Shared piece 2", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  const placementA = await prisma.articlePlacement.create({ data: { orderLineId: lineA.id, articleId: article.id } });
  const placementB = await prisma.articlePlacement.create({ data: { orderLineId: lineB.id, articleId: article.id } });

  // Retract A only.
  await prisma.articlePlacement.update({
    where: { id: placementA.id },
    data: { retractedAt: new Date(), retractedBy: user.id, retractionNote: "test" },
  });
  const reloadedB = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placementB.id } });
  assert.equal(reloadedB.retractedAt, null);

  // Now go FINAL — both unlocked placements (B is unlocked; A is retracted
  // but that's an independent field, not a lock state) should lock to it.
  const finalVersion = await prisma.contentAsset.create({
    data: { articleId: article.id, version: 1, body: "final text", status: "FINAL" },
  });
  const { lockPlacementsOnFinal } = await import("@/lib/writers/placement");
  await lockPlacementsOnFinal(article.id, finalVersion.id);

  const lockedA = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placementA.id } });
  const lockedB = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placementB.id } });
  assert.equal(lockedA.lockedAssetId, finalVersion.id);
  assert.equal(lockedB.lockedAssetId, finalVersion.id);
  assert.notEqual(lockedA.retractedAt, null); // retraction survives the lock

  await prisma.articlePlacement.deleteMany({ where: { id: { in: [placementA.id, placementB.id] } } });
  await prisma.contentAsset.delete({ where: { id: finalVersion.id } });
  await prisma.article.delete({ where: { id: article.id } });
  await prisma.orderLine.deleteMany({ where: { id: { in: [lineA.id, lineB.id] } } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.quote.delete({ where: { id: quote.id } });
  await prisma.request.delete({ where: { id: request.id } });
  await prisma.plan.delete({ where: { id: plan.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});
```

Leave the first test ("buyer creates an unlinked article, uploads a file, sees it
in org-scoped overview") and the third ("canWriteArticle: journalist assigned via
WriterProfile.userId") unchanged — neither touches the 1:1 invariant this plan
removes.

- [ ] **Step 3: Run**

Run: `ALLOW_LOCAL_DB=1 pnpm exec tsx --test src/app/article-library.it.test.ts`
Expected: PASS, 4 tests (1 unchanged + 2 rewritten + 1 new, minus the old
2nd test which is replaced rather than added alongside).

- [ ] **Step 4: Run the full `test:it` and unit suites**

Run: `pnpm test:it` and `pnpm test`
Expected: both pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/app/article-library.it.test.ts
git commit -m "test: cover multi-placement articles, retraction independence, version locking"
```

---

## Post-implementation checklist

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:it` all pass.
- [ ] Manual walkthrough: link one article to two different placements; run spec
  check independently on each (different products, confirm different results are
  possible); retract one placement's publisher veto and confirm the sibling
  placement is unaffected; write a new draft and confirm the "linked to N other
  placements" warning appears; push a version to FINAL and confirm both unlocked
  placements lock to it, then write a further version and confirm neither
  already-locked placement's displayed content changes.
- [ ] Manual walkthrough: on `/plan`, create a programme, create an article for a
  wave from the wave strip, confirm it appears in the RFQ brief text via
  `withWaveAngle`, unlink it, confirm the brief line disappears.
- [ ] Confirm the migration's `INSERT ... SELECT` backfill and the `RETRACTED`
  enum-value removal run cleanly against a realistic seed before this merges to
  `main`, given the no-staging-gate deploy.
