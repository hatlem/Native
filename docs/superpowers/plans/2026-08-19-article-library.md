# Article Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let journalists write or upload an article, let buyers upload their own material, and give buyers an overview of every article and which placement (if any) it's linked to.

**Architecture:** A new `Article` model becomes the parent of `ContentAsset` (versions), replacing `ContentBrief` in that role. `ContentBrief` keeps its current shape and creation code untouched — it becomes read-only guidance text next to whichever `Article` is linked to that order line. `Article.orderLineId` is nullable and unique, so an article can exist before any placement is chosen, and links to at most one placement.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Prisma/PostgreSQL, `tsx --test` (node:test) for unit tests, Cloudflare R2 via `@aws-sdk/client-s3` for uploads, next-intl for copy.

**Spec:** `docs/superpowers/specs/2026-08-19-article-library-design.md`

## Global Constraints

- One article ↔ zero-or-one placement (`Article.orderLineId` unique, nullable) — no many-to-many.
- Upload types: PDF, DOCX, TXT only. Max size: 25MB (matches existing `MAX_BYTES` in `src/lib/storage/r2.ts`).
- Spec check (word count / disclosure) only runs for typed text on a *linked* article — never for uploaded files, never before linking.
- `accept-quote.ts` and `firm-order.ts` (order-confirmation transactions) are not modified.
- Every server action must record an audit entry via `recordAudit()` (`src/lib/audit.ts`), matching existing conventions.
- New UI copy goes through next-intl (`src/messages/*.json`) in all six locales (en, no, da, sv, fi, de) — the existing `locale key parity` test (`src/messages/market-labels.test.ts`) fails the build if any locale is missing a key.
- Every new/changed pure decision function gets a `node:test` unit test colocated as `*.test.ts`.

---

### Task 1: Schema — `Article` model and migration with data backfill

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260819130000_article_library/migration.sql`

**Interfaces:**
- Produces: `model Article` with fields `id, organizationId, title, createdByUserId, createdByRole, assignedWriterId?, orderLineId? (unique), createdAt, updatedAt`, relation `versions: ContentAsset[]`. `ContentAsset.articleId` (replaces `briefId`). `OrderLine.article: Article?` (inverse of `Article.orderLineId`). `ContentBrief` loses its `assets` relation field (nothing else changes).

- [ ] **Step 1: Add the `Article` model and repoint `ContentAsset`/`ContentBrief`/`OrderLine`/`Organization`/`WriterProfile`**

In `prisma/schema.prisma`, add after `model ContentBrief` (currently lines 1239-1252):

```prisma
model Article {
  id               String        @id @default(cuid())
  organizationId   String
  organization     Organization  @relation(fields: [organizationId], references: [id])
  title            String
  createdByUserId  String
  createdByRole    UserRole
  assignedWriterId String?
  assignedWriter   WriterProfile? @relation("ArticleAssignedWriter", fields: [assignedWriterId], references: [id])
  orderLineId      String?       @unique
  orderLine        OrderLine?    @relation(fields: [orderLineId], references: [id])
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  versions ContentAsset[]

  @@index([organizationId])
  @@index([assignedWriterId])
}
```

In `model ContentBrief`, delete the line `assets ContentAsset[]`.

In `model ContentAsset`, change:
```prisma
  briefId     String
  brief       ContentBrief       @relation(fields: [briefId], references: [id])
```
to:
```prisma
  articleId   String
  article     Article            @relation(fields: [articleId], references: [id])
```

In `model OrderLine`, add (alongside the existing `brief ContentBrief?` line):
```prisma
  article     Article?
```

In `model Organization`, add to the relations block (near `orders: Order[]`):
```prisma
  articles Article[]
```

In `model WriterProfile`, add alongside `assignedLines: OrderLine[] @relation("LineAssignedWriter")`:
```prisma
  assignedArticles Article[] @relation("ArticleAssignedWriter")
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm prisma migrate dev --name article_library --create-only
```

This creates `prisma/migrations/<timestamp>_article_library/migration.sql` with the `CREATE TABLE "Article"` and `ALTER TABLE "ContentAsset"` DDL. Do not run it yet — Step 3 hand-edits it to add the data backfill between the `CREATE TABLE "Article"` and the `ALTER TABLE "ContentAsset" ... ADD COLUMN "articleId"` statements, because existing `ContentAsset` rows need an `Article` to point at before the new column can be made `NOT NULL`.

- [ ] **Step 3: Hand-edit the migration to backfill existing data**

Prisma will generate `articleId` as nullable-then-required across two steps, or as required with no default (which fails on existing rows). Rewrite the generated SQL file to this exact shape:

```sql
-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByRole" "UserRole" NOT NULL,
    "assignedWriterId" TEXT,
    "orderLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Article_orderLineId_key" ON "Article"("orderLineId");
CREATE INDEX "Article_organizationId_idx" ON "Article"("organizationId");
CREATE INDEX "Article_assignedWriterId_idx" ON "Article"("assignedWriterId");

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_assignedWriterId_fkey" FOREIGN KEY ("assignedWriterId") REFERENCES "WriterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one Article per existing ContentBrief that has at least one
-- ContentAsset version. organizationId comes from the order; title is
-- derived from the placement's product/title name, falling back to a
-- truncated brief message, then to "Untitled article"; createdByUserId
-- is the earliest version's author (falling back to any DESK/SUPERADMIN
-- user, since every org has at least one desk account managing it).
INSERT INTO "Article" ("id", "organizationId", "title", "createdByUserId", "createdByRole", "assignedWriterId", "orderLineId", "createdAt", "updatedAt")
SELECT
  'mig_' || cb.id,
  o."organizationId",
  COALESCE(t."name", NULLIF(LEFT(cb."message", 80), ''), 'Untitled article'),
  COALESCE(
    (SELECT wp."userId" FROM "ContentAsset" ca
       JOIN "WriterProfile" wp ON wp.id = ca."authorWriterId"
      WHERE ca."briefId" = cb.id ORDER BY ca."version" ASC LIMIT 1),
    (SELECT u.id FROM "User" u WHERE u.role IN ('DESK', 'SUPERADMIN') ORDER BY u."createdAt" ASC LIMIT 1)
  ),
  'CONTENT',
  ol."assignedWriterId",
  cb."orderLineId",
  cb."createdAt",
  cb."updatedAt"
FROM "ContentBrief" cb
JOIN "OrderLine" ol ON ol.id = cb."orderLineId"
JOIN "Order" o ON o.id = ol."orderId"
LEFT JOIN "Product" p ON p.id = ol."productId"
LEFT JOIN "Title" t ON t.id = p."titleId"
WHERE EXISTS (SELECT 1 FROM "ContentAsset" ca WHERE ca."briefId" = cb.id);

-- AlterTable: add articleId (nullable first so the UPDATE below can run)
ALTER TABLE "ContentAsset" ADD COLUMN "articleId" TEXT;

UPDATE "ContentAsset" ca
SET "articleId" = 'mig_' || ca."briefId"
FROM "ContentBrief" cb
WHERE cb.id = ca."briefId";

-- Every ContentAsset row now has an articleId (backfilled above, since
-- the INSERT's WHERE EXISTS guarantees an Article exists for every brief
-- that owns at least one asset). Make it required and drop the old FK.
ALTER TABLE "ContentAsset" ALTER COLUMN "articleId" SET NOT NULL;
ALTER TABLE "ContentAsset" DROP CONSTRAINT "ContentAsset_briefId_fkey";
ALTER TABLE "ContentAsset" DROP COLUMN "briefId";
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Keep whatever index-rename statements Prisma generated for `ContentAsset` (e.g. renaming an index that referenced `briefId`) — remove any that reference the now-dropped `briefId` column, since the block above already drops it explicitly.

- [ ] **Step 4: Apply the migration locally and regenerate the client**

```bash
pnpm prisma migrate dev
pnpm prisma:generate
```

Expected: migration applies with no errors. If your local DB has no existing `ContentBrief`/`ContentAsset` rows, the `INSERT ... SELECT` simply inserts zero rows — harmless.

- [ ] **Step 5: Verify the schema compiles**

```bash
pnpm typecheck
```

Expected: this will show errors in every file still referencing `brief`/`briefId`/`ContentBrief.assets` — that's expected, they're fixed in Tasks 5-8. Confirm the *only* errors are in `src/app/desk-content-actions.ts`, `src/app/content-review-actions.ts`, `src/lib/spec-check-runner.ts`, and `src/app/[locale]/writer/lines/[lineId]/page.tsx`. If errors appear anywhere else, stop and investigate before continuing.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260819130000_article_library
git commit -m "feat(db): add Article model, backfill from ContentBrief"
```

---

### Task 2: `canWriteArticle` permission logic

**Files:**
- Modify: `src/lib/writers/access.ts`
- Create: `src/lib/writers/access.test.ts`

**Interfaces:**
- Consumes: nothing new (pure function, no DB).
- Produces: `canWriteArticle(args: { role: string | undefined; userId: string | undefined; organizationId: string; scopeOrgIds: string[]; assignedWriterUserId: string | null | undefined }): boolean`, used by Task 3's guard functions, which are in turn used by Tasks 6 and 9's article actions.

- [ ] **Step 1: Write the failing test**

Create `src/lib/writers/access.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canWriteArticle } from "./access";

test("canWriteArticle: DESK can always write", () => {
  assert.equal(
    canWriteArticle({
      role: "DESK",
      userId: "u1",
      organizationId: "org1",
      scopeOrgIds: [],
      assignedWriterUserId: null,
    }),
    true,
  );
});

test("canWriteArticle: SUPERADMIN can always write", () => {
  assert.equal(
    canWriteArticle({
      role: "SUPERADMIN",
      userId: "u1",
      organizationId: "org1",
      scopeOrgIds: [],
      assignedWriterUserId: null,
    }),
    true,
  );
});

test("canWriteArticle: CONTENT can write only if assigned to this article", () => {
  assert.equal(
    canWriteArticle({
      role: "CONTENT",
      userId: "writer1",
      organizationId: "org1",
      scopeOrgIds: [],
      assignedWriterUserId: "writer1",
    }),
    true,
  );
  assert.equal(
    canWriteArticle({
      role: "CONTENT",
      userId: "writer1",
      organizationId: "org1",
      scopeOrgIds: [],
      assignedWriterUserId: "someone-else",
    }),
    false,
  );
  assert.equal(
    canWriteArticle({
      role: "CONTENT",
      userId: "writer1",
      organizationId: "org1",
      scopeOrgIds: [],
      assignedWriterUserId: null,
    }),
    false,
  );
});

test("canWriteArticle: BUYER/APPROVER/ORG_ADMIN can write only within their org scope", () => {
  for (const role of ["BUYER", "APPROVER", "ORG_ADMIN"]) {
    assert.equal(
      canWriteArticle({
        role,
        userId: "buyer1",
        organizationId: "org1",
        scopeOrgIds: ["org1", "org2"],
        assignedWriterUserId: null,
      }),
      true,
      `${role} in scope should be able to write`,
    );
    assert.equal(
      canWriteArticle({
        role,
        userId: "buyer1",
        organizationId: "org3",
        scopeOrgIds: ["org1", "org2"],
        assignedWriterUserId: null,
      }),
      false,
      `${role} out of scope should not be able to write`,
    );
  }
});

test("canWriteArticle: PUBLISHER and unauthenticated cannot write", () => {
  assert.equal(
    canWriteArticle({
      role: "PUBLISHER",
      userId: "pub1",
      organizationId: "org1",
      scopeOrgIds: ["org1"],
      assignedWriterUserId: null,
    }),
    false,
  );
  assert.equal(
    canWriteArticle({
      role: "BUYER",
      userId: undefined,
      organizationId: "org1",
      scopeOrgIds: ["org1"],
      assignedWriterUserId: null,
    }),
    false,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test src/lib/writers/access.test.ts`
Expected: FAIL — `canWriteArticle` is not exported from `./access`.

- [ ] **Step 3: Implement `canWriteArticle`**

In `src/lib/writers/access.ts`, add below `canWriteLine`:

```ts
const ORG_SCOPED_ROLES = new Set(["BUYER", "APPROVER", "ORG_ADMIN"]);

export function canWriteArticle(args: {
  role: string | undefined;
  userId: string | undefined;
  organizationId: string;
  scopeOrgIds: string[];
  assignedWriterUserId: string | null | undefined;
}): boolean {
  const { role, userId, organizationId, scopeOrgIds, assignedWriterUserId } = args;
  if (!userId) return false;
  if (role === "DESK" || role === "SUPERADMIN") return true;
  if (role === "CONTENT") return assignedWriterUserId === userId;
  if (role && ORG_SCOPED_ROLES.has(role)) return scopeOrgIds.includes(organizationId);
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test src/lib/writers/access.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/writers/access.ts src/lib/writers/access.test.ts
git commit -m "feat(writers): add canWriteArticle permission check"
```

---

### Task 3: Guard functions for article access

**Files:**
- Modify: `src/lib/writers/guard.ts`

**Interfaces:**
- Consumes: `canWriteArticle` from Task 2 (`src/lib/writers/access.ts`), `loadScope` from `src/lib/scope.ts`.
- Produces: `requireArticleWriter(articleId: string, locale: string): Promise<{ userId: string; role: string; writerProfileId: string | null; organizationId: string }>` and `requireOrgArticleAccess(organizationId: string, locale: string): Promise<{ userId: string; role: string }>`, both consumed by Tasks 5, 6, 9, 11.

- [ ] **Step 1: Add the two guard functions**

In `src/lib/writers/guard.ts`, add imports and the new functions:

```ts
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadScope } from "@/lib/scope";
import { canWriteLine, canWriteArticle } from "./access";

// ... existing requireLineWriter unchanged ...

export async function requireArticleWriter(
  articleId: string,
  locale: string,
): Promise<{
  userId: string;
  role: string;
  writerProfileId: string | null;
  organizationId: string;
}> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!session?.user || !userId) redirect(`/${locale}/signin`);

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      organizationId: true,
      assignedWriter: { select: { id: true, userId: true } },
    },
  });
  if (!article) redirect(`/${locale}/articles`);

  const scope = await loadScope();
  const ok = canWriteArticle({
    role,
    userId,
    organizationId: article.organizationId,
    scopeOrgIds: scope.workspace?.scopeOrgIds ?? [],
    assignedWriterUserId: article.assignedWriter?.userId ?? null,
  });
  if (!ok) redirect(`/${locale}/articles`);

  const writerProfileId = role === "CONTENT" ? (article.assignedWriter?.id ?? null) : null;
  return { userId, role: role as string, writerProfileId, organizationId: article.organizationId };
}

export async function requireOrgArticleAccess(
  organizationId: string,
  locale: string,
): Promise<{ userId: string; role: string }> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!session?.user || !userId) redirect(`/${locale}/signin`);

  const scope = await loadScope();
  const ok = canWriteArticle({
    role,
    userId,
    organizationId,
    scopeOrgIds: scope.workspace?.scopeOrgIds ?? [],
    assignedWriterUserId: null,
  });
  if (!ok) redirect(`/${locale}/articles`);
  return { userId, role: role as string };
}
```

Note: `requireOrgArticleAccess` passes `assignedWriterUserId: null`, which means `CONTENT` always fails it — correct, since journalists never self-initiate an article (Global Constraints / spec §Permissions).

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck 2>&1 | grep -A2 "guard.ts"`
Expected: no errors from `guard.ts` itself (errors from other not-yet-fixed files are expected and unrelated).

- [ ] **Step 3: Commit**

```bash
git add src/lib/writers/guard.ts
git commit -m "feat(writers): add requireArticleWriter and requireOrgArticleAccess guards"
```

---

### Task 4: `r2.ts` — parameterize allowed upload types

**Files:**
- Modify: `src/lib/storage/r2.ts`
- Create: `src/lib/storage/r2.test.ts`
- Modify: `src/app/[locale]/rate-card/[token]/actions.ts:38-43` (pass explicit `allowedTypes` so its behavior is unchanged)

**Interfaces:**
- Produces: `validateContentType(ct: string, allowedTypes?: ReadonlySet<string>): boolean`, `presignUpload(args: { prefix, filename, contentType, bytes, ttlSec?, allowedTypes? })`, `putObject(args: { ..., allowedTypes? })`, plus exported constants `RATE_CARD_TYPES` and `ARTICLE_TYPES` — consumed by Task 9's `presignArticleUpload`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/storage/r2.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateContentType, isAllowedSize, buildObjectKey, ARTICLE_TYPES, RATE_CARD_TYPES } from "./r2";

test("validateContentType: defaults to the rate-card type set when no override given", () => {
  assert.equal(validateContentType("application/pdf"), true);
  assert.equal(validateContentType("text/plain"), false);
});

test("validateContentType: ARTICLE_TYPES allows PDF/DOCX/TXT, rejects images and PPT", () => {
  assert.equal(validateContentType("application/pdf", ARTICLE_TYPES), true);
  assert.equal(
    validateContentType(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ARTICLE_TYPES,
    ),
    true,
  );
  assert.equal(validateContentType("text/plain", ARTICLE_TYPES), true);
  assert.equal(validateContentType("image/png", ARTICLE_TYPES), false);
  assert.equal(
    validateContentType("application/vnd.ms-powerpoint", ARTICLE_TYPES),
    false,
  );
});

test("validateContentType: RATE_CARD_TYPES matches today's behavior exactly", () => {
  assert.equal(validateContentType("application/pdf", RATE_CARD_TYPES), true);
  assert.equal(validateContentType("image/png", RATE_CARD_TYPES), true);
  assert.equal(validateContentType("text/plain", RATE_CARD_TYPES), false);
});

test("isAllowedSize and buildObjectKey are unaffected", () => {
  assert.equal(isAllowedSize(1024), true);
  assert.equal(isAllowedSize(0), false);
  assert.match(buildObjectKey({ prefix: "articles/a1", filename: "My Draft.docx" }), /^articles\/a1\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+-my-draft\.docx$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test src/lib/storage/r2.test.ts`
Expected: FAIL — `ARTICLE_TYPES`/`RATE_CARD_TYPES` are not exported.

- [ ] **Step 3: Parameterize `r2.ts`**

Replace the top of `src/lib/storage/r2.ts` (lines 5-16) with:

```ts
export const RATE_CARD_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "image/png",
  "image/jpeg",
]);

export const ARTICLE_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const MAX_BYTES = 25 * 1024 * 1024;

export function validateContentType(
  ct: string,
  allowedTypes: ReadonlySet<string> = RATE_CARD_TYPES,
): boolean {
  return allowedTypes.has(ct.toLowerCase());
}
```

Then update `presignUpload` and `putObject` to accept and forward an optional `allowedTypes`:

```ts
export async function presignUpload(args: {
  prefix: string;
  filename: string;
  contentType: string;
  bytes: number;
  ttlSec?: number;
  allowedTypes?: ReadonlySet<string>;
}): Promise<{ url: string; key: string }> {
  if (!validateContentType(args.contentType, args.allowedTypes)) {
    throw new Error(`content_type_not_allowed:${args.contentType}`);
  }
  if (!isAllowedSize(args.bytes)) {
    throw new Error(`file_size_not_allowed:${args.bytes}`);
  }
  const key = buildObjectKey({ prefix: args.prefix, filename: args.filename });
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: args.contentType,
    ContentLength: args.bytes,
  });
  const url = await getSignedUrl(client(), cmd, { expiresIn: args.ttlSec ?? 300 });
  return { url, key };
}
```

```ts
export async function putObject(args: {
  prefix: string;
  filename: string;
  contentType: string;
  body: Buffer;
  allowedTypes?: ReadonlySet<string>;
}): Promise<{ key: string; sizeBytes: number }> {
  if (!validateContentType(args.contentType, args.allowedTypes)) {
    throw new Error(`content_type_not_allowed:${args.contentType}`);
  }
  if (!isAllowedSize(args.body.byteLength)) {
    throw new Error(`file_size_not_allowed:${args.body.byteLength}`);
  }
  const key = buildObjectKey({ prefix: args.prefix, filename: args.filename });
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: args.body,
      ContentType: args.contentType,
      ContentLength: args.body.byteLength,
    }),
  );
  return { key, sizeBytes: args.body.byteLength };
}
```

`buildObjectKey` and `isAllowedSize` are unchanged.

- [ ] **Step 4: Keep rate-card behavior explicit**

In `src/app/[locale]/rate-card/[token]/actions.ts`, update the `presignUpload` call at line 38 to pass `allowedTypes: RATE_CARD_TYPES` explicitly (defensive — the default already matches, but this keeps call sites self-documenting once a second type set exists):

```ts
import { presignUpload, RATE_CARD_TYPES } from "@/lib/storage/r2";
// ...
  return presignUpload({
    prefix: `rate-cards/${args.token}`,
    filename: args.filename,
    contentType: args.contentType,
    bytes: args.bytes,
    allowedTypes: RATE_CARD_TYPES,
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec tsx --test src/lib/storage/r2.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Full typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "r2.ts\|rate-card"`
Expected: no errors from these files.

- [ ] **Step 7: Commit**

```bash
git add src/lib/storage/r2.ts src/lib/storage/r2.test.ts src/app/[locale]/rate-card/[token]/actions.ts
git commit -m "feat(storage): parameterize allowed upload types, add ARTICLE_TYPES"
```

---

### Task 5: Auto-create the `Article` when a writer is assigned to a line

**Files:**
- Modify: `src/app/writer-pool-actions.ts:61-105`

**Interfaces:**
- Consumes: `prisma.article`, `writerStaffableLine` (`src/lib/authorship.ts`, unchanged).
- Produces: guarantees that after `assignWriterToLine` succeeds, `OrderLine.article` exists with `assignedWriterId` set — consumed by Task 6's `saveDraft`/`setAssetStatus`.

- [ ] **Step 1: Add article creation/update to `assignWriterToLine`**

In `src/app/writer-pool-actions.ts`, replace the final block of `assignWriterToLine` (lines 98-104):

```ts
  await prisma.orderLine.update({
    where: { id: orderLineId },
    data: { assignedWriterId: writerId, assignedById: userId, assignedAt: new Date() },
  });
  await recordAudit(userId, "line.assign", `OrderLine:${orderLineId}`, { writerId });

  redirect(`/${locale}/desk/orders/${orderId}`);
```

with:

```ts
  const updatedLine = await prisma.orderLine.update({
    where: { id: orderLineId },
    data: { assignedWriterId: writerId, assignedById: userId, assignedAt: new Date() },
    select: { id: true, order: { select: { organizationId: true } } },
  });
  await recordAudit(userId, "line.assign", `OrderLine:${orderLineId}`, { writerId });

  // First assignment for this line creates its Article; a re-assignment
  // (previous writer swapped for a new one) just repoints assignedWriterId.
  const existing = await prisma.article.findUnique({ where: { orderLineId } });
  if (existing) {
    await prisma.article.update({
      where: { id: existing.id },
      data: { assignedWriterId: writerId },
    });
  } else {
    const line = await prisma.orderLine.findUnique({
      where: { id: orderLineId },
      select: {
        productId: true,
        order: { select: { organizationId: true } },
      },
    });
    const product = line?.productId
      ? await prisma.product.findUnique({
          where: { id: line.productId },
          select: { title: { select: { name: true } } },
        })
      : null;
    await prisma.article.create({
      data: {
        organizationId: updatedLine.order.organizationId,
        title: product?.title.name ?? "Untitled article",
        createdByUserId: userId,
        createdByRole: "DESK",
        assignedWriterId: writerId,
        orderLineId,
      },
    });
  }
  await recordAudit(userId, "article.assign", `OrderLine:${orderLineId}`, { writerId });

  redirect(`/${locale}/desk/orders/${orderId}`);
```

Note: the unassign branch (`writerId === ""`, lines 68-75) is unchanged — it clears `OrderLine.assignedWriterId` but intentionally leaves `Article.assignedWriterId` alone here; add the matching clear so the two stay consistent. Replace that branch's body:

```ts
  if (writerId === "") {
    await prisma.orderLine.update({
      where: { id: orderLineId },
      data: { assignedWriterId: null, assignedAt: null, assignedById: null },
    });
    await prisma.article.updateMany({
      where: { orderLineId },
      data: { assignedWriterId: null },
    });
    await recordAudit(userId, "line.unassign", `OrderLine:${orderLineId}`);
    redirect(`/${locale}/desk/orders/${orderId}`);
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "writer-pool-actions"`
Expected: no errors.

- [ ] **Step 3: Manual verification**

This action has no existing unit test (it's a server action with redirects, consistent with the rest of the file). Verify via the integration test in Task 15, which exercises this path end-to-end.

- [ ] **Step 4: Commit**

```bash
git add src/app/writer-pool-actions.ts
git commit -m "feat(writers): auto-create Article when a writer is assigned to a line"
```

---

### Task 6: Repoint `desk-content-actions.ts` at `Article`, add upload variant

**Files:**
- Modify: `src/app/desk-content-actions.ts`

**Interfaces:**
- Consumes: `requireArticleWriter` (Task 3).
- Produces: `saveDraft`, `saveUploadedDraft`, `runSpecCheck`, `setAssetStatus`, `confirmTrackedLinks` — all now `articleId`/`Article`-scoped. Consumed by Task 10 (writer page) and Task 13 (article detail page). Note: the presign step for uploads is `presignArticleUpload` from Task 9 (`article-library-actions.ts`), not defined here — `saveUploadedDraft` only persists the `bodyUrl` a client already obtained from that action.

- [ ] **Step 1: Replace brief lookups with article lookups**

In `src/app/desk-content-actions.ts`, change the import at line 12 from `requireLineWriter` to also import `requireArticleWriter`:

```ts
import { requireLineWriter, requireArticleWriter } from "@/lib/writers/guard";
```

Replace `confirmTrackedLinks` (lines 38-68) — it reads/writes `ContentAsset.body` by `assetId`, unrelated to the brief/article parent, so only its internal shape needs no change. Leave it as-is except it still uses `requireLineWriter(orderLineId, locale)`, which is fine — that guard still exists for line-scoped actions.

Replace `saveDraft` (lines 70-114) entirely:

```ts
export async function saveDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const orderId = field(formData, "orderId");
  const body = field(formData, "body");
  const sourceAssetId = field(formData, "sourceAssetId") || null;
  const { userId, writerProfileId, role } = await requireArticleWriter(articleId, locale);

  if (body) {
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
        body,
        sourceAssetId: sourceAssetId || null,
        authorWriterId: writerProfileId,
      },
    });
    await recordAudit(userId, "asset.draft", `ContentAsset:${asset.id}`, {
      version: nextVersion,
      sourceAssetId: sourceAssetId || null,
    });
    await enqueue("spec.check", { assetId: asset.id });
  }
  redirect(
    role === "CONTENT"
      ? `/${locale}/articles/${articleId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}

// The client obtains a presigned PUT url via presignArticleUpload
// (src/app/article-library-actions.ts, Task 9), PUTs the file directly to
// R2, then submits this action with the returned key as bodyUrl.
export async function saveUploadedDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const orderId = field(formData, "orderId");
  const bodyUrl = field(formData, "bodyUrl");
  const { userId, writerProfileId, role } = await requireArticleWriter(articleId, locale);

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
    // No spec.check enqueue — uploaded files are never spec-checked (design §Status flow and spec check).
  }
  redirect(
    role === "CONTENT"
      ? `/${locale}/articles/${articleId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}
```

Replace `runSpecCheck` (lines 116-135):

```ts
export async function runSpecCheck(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { articleId: true },
  });
  const articleId = asset?.articleId ?? "";
  const { userId, role } = await requireArticleWriter(articleId, locale);

  await runSpecCheckForAsset(assetId);
  await recordAudit(userId, "asset.spec_check", `ContentAsset:${assetId}`);

  redirect(
    role === "CONTENT"
      ? `/${locale}/articles/${articleId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}
```

Replace `setAssetStatus` (lines 137-191), swapping every `brief.orderLineId`/`brief.orderLine` lookup for the article-based equivalent:

```ts
export async function setAssetStatus(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const target = field(formData, "target") as ContentAssetStatus;
  const assetForArticle = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { articleId: true },
  });
  const articleId = assetForArticle?.articleId ?? "";
  const { userId, role } = await requireArticleWriter(articleId, locale);

  if (role === "CONTENT" && !CONTENT_ASSET_TARGETS.has(target)) {
    redirect(`/${locale}/articles/${articleId}`);
  }

  if (ASSET_TARGETS.includes(target)) {
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      include: { article: { select: { organizationId: true, orderLineId: true } } },
    });
    if (asset && !(target === "FINAL" && asset.specPassed !== true)) {
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: { status: target },
      });
      await recordAudit(userId, "asset.status", `ContentAsset:${asset.id}`, {
        status: target,
      });
      if (target === "IN_REVIEW" || target === "CHANGES_REQUESTED") {
        await notifyOrg(asset.article.organizationId, {
          kind: "ASSET_REVIEW",
          title:
            target === "IN_REVIEW"
              ? "Content draft ready for review"
              : "Content changes requested",
          link: asset.article.orderLineId
            ? `/${locale}/orders/${orderId}`
            : `/${locale}/articles/${articleId}`,
        });
      }
    }
  }
  redirect(
    role === "CONTENT"
      ? `/${locale}/articles/${articleId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "desk-content-actions"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/desk-content-actions.ts
git commit -m "feat(content): repoint desk-content-actions at Article, add upload variant"
```

---

### Task 7: Repoint `content-review-actions.ts` at `Article`

**Files:**
- Modify: `src/app/content-review-actions.ts`

**Interfaces:**
- Consumes: nothing new — `canActOnOrg`/`loadScope` unchanged.
- Produces: `approveContentAsset`, `requestContentChanges` — now read `asset.article.organizationId`/`asset.article.orderLineId` instead of `asset.brief.orderLine.order.organizationId`.

- [ ] **Step 1: Update `loadAssetForBuyer` and both actions**

Replace `loadAssetForBuyer` (lines 23-41):

```ts
async function loadAssetForBuyer(assetId: string) {
  return prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      status: true,
      article: {
        select: {
          id: true,
          organizationId: true,
          orderLineId: true,
          orderLine: { select: { orderId: true } },
        },
      },
    },
  });
}
```

In `approveContentAsset` (lines 43-69), replace the body:

```ts
export async function approveContentAsset(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
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

  const orderId = asset.article.orderLine?.orderId ?? null;
  await prisma.contentAsset.update({ where: { id: assetId }, data: { status: "APPROVED" } });
  await recordAudit(session.user.id, "asset.status", `ContentAsset:${assetId}`, { status: "APPROVED" });
  await notifyDesk({
    kind: "ASSET_REVIEW",
    title: "Buyer approved a draft",
    link: orderId ? `/${locale}/desk/orders/${orderId}` : `/${locale}/desk/articles/${asset.article.id}`,
  });

  redirect(orderId ? `/${locale}/orders/${orderId}` : `/${locale}/articles/${asset.article.id}`);
}
```

In `requestContentChanges` (lines 71-103), apply the same substitution pattern:

```ts
export async function requestContentChanges(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const note = field(formData, "note");
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

  const orderId = asset.article.orderLine?.orderId ?? null;
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
    link: orderId ? `/${locale}/desk/orders/${orderId}` : `/${locale}/desk/articles/${asset.article.id}`,
  });

  redirect(orderId ? `/${locale}/orders/${orderId}` : `/${locale}/articles/${asset.article.id}`);
}
```

(The `/desk/articles/[id]` link target is a fallback for the desk-side view of an unlinked article; no such page is built in this plan — Task 13 builds a buyer/journalist-facing detail page only. Leave the link as a dead link for now if the article is unlinked; DESK/SUPERADMIN can still reach it by querying the DB or a future desk view. This is acceptable because an unlinked article cannot reach `IN_REVIEW` through the buyer flow in practice — buyers act on their own org's assets, and desk notification linking is a convenience, not a gate.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "content-review-actions"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/content-review-actions.ts
git commit -m "feat(content): repoint content-review-actions at Article"
```

---

### Task 8: Repoint `spec-check-runner.ts`, skip for unlinked/uploaded

**Files:**
- Modify: `src/lib/spec-check-runner.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `runSpecCheckForAsset(assetId)` — now no-ops (leaves `specPassed`/`reviewNotes` untouched) when the asset has no `body` (upload) or its article has no `orderLineId` (unlinked), instead of crashing or checking against a nonexistent product.

- [ ] **Step 1: Update the lookup and add the two guard conditions**

Replace `runSpecCheckForAsset` (the whole function, lines 9-48):

```ts
export async function runSpecCheckForAsset(assetId: string): Promise<void> {
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    include: {
      article: { include: { orderLine: { select: { productId: true } } } },
    },
  });
  if (!asset) return;

  // Uploaded files are never spec-checked (no reliable text to check).
  if (!asset.body) return;

  // Spec check needs a placement's Product to know word-count/disclosure
  // requirements. An article not yet linked to a placement has none.
  const productId = asset.article.orderLine?.productId;
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

  await prisma.contentAsset.update({
    where: { id: asset.id },
    data: {
      specPassed: result.passed,
      reviewNotes: result.passed
        ? `Spec passed (${result.words} words)`
        : result.issues.join("; "),
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "spec-check-runner"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/spec-check-runner.ts
git commit -m "feat(content): repoint spec-check-runner at Article, skip when unlinked or uploaded"
```

---

### Task 9: New `article-library-actions.ts` — create, upload-presign, link

**Files:**
- Create: `src/app/article-library-actions.ts`

**Interfaces:**
- Consumes: `requireOrgArticleAccess`, `requireArticleWriter` (Task 3), `ARTICLE_TYPES`/`presignUpload` (Task 4), `recordAudit`.
- Produces: `createArticle(formData)`, `presignArticleUpload(args)` (the sole presign entry point for article uploads, used by both the journalist and buyer upload UI in Task 13), `linkArticleToOrderLine(formData)`. Consumed by Task 12 and Task 13 pages.

- [ ] **Step 1: Write the file**

```ts
"use server";

import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { requireOrgArticleAccess, requireArticleWriter } from "@/lib/writers/guard";
import { presignUpload, ARTICLE_TYPES } from "@/lib/storage/r2";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Self-serve creation: a buyer creates an article for their own org, or
// DESK creates one (optionally pre-assigning a writer) for a client org.
export async function createArticle(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const organizationId = field(formData, "organizationId");
  const title = field(formData, "title");
  const { userId, role } = await requireOrgArticleAccess(organizationId, locale);

  if (!title) redirect(`/${locale}/articles/new?error=title`);

  const article = await prisma.article.create({
    data: {
      organizationId,
      title,
      createdByUserId: userId,
      // `role` comes from requireOrgArticleAccess, sourced from the
      // authenticated session's DB-backed User.role — always a valid
      // UserRole at runtime, so this cast (not a validated narrowing) is safe.
      createdByRole: role as UserRole,
    },
  });
  await recordAudit(userId, "article.create", `Article:${article.id}`, { organizationId });

  redirect(`/${locale}/articles/${article.id}`);
}

export async function presignArticleUpload(args: {
  articleId: string;
  locale: string;
  filename: string;
  contentType: string;
  bytes: number;
}): Promise<{ url: string; key: string }> {
  await requireArticleWriter(args.articleId, args.locale);
  return presignUpload({
    prefix: `articles/${args.articleId}`,
    filename: args.filename,
    contentType: args.contentType,
    bytes: args.bytes,
    allowedTypes: ARTICLE_TYPES,
  });
}

// Links an unlinked Article to an eligible INVENTORY OrderLine in the same
// organization that doesn't already have an article. Enforces the 1:1
// invariant at the DB level too (Article.orderLineId is unique).
export async function linkArticleToOrderLine(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const orderLineId = field(formData, "orderLineId");
  const { userId } = await requireArticleWriter(articleId, locale);

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { organizationId: true, orderLineId: true },
  });
  if (!article || article.orderLineId) redirect(`/${locale}/articles/${articleId}`);

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

  try {
    await prisma.article.update({
      where: { id: articleId },
      data: { orderLineId },
    });
  } catch {
    // P2002 unique violation — someone else linked this line first between
    // our read and write. Surface as a link error rather than a crash.
    redirect(`/${locale}/articles/${articleId}?error=taken`);
  }
  await recordAudit(userId, "article.link", `Article:${articleId}`, { orderLineId });

  redirect(`/${locale}/articles/${articleId}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "article-library-actions"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/article-library-actions.ts
git commit -m "feat(content): add self-serve article create/upload/link actions"
```

---

### Task 10: Update `writer/lines/[lineId]/page.tsx` to read via `Article`

**Files:**
- Modify: `src/app/[locale]/writer/lines/[lineId]/page.tsx`

**Interfaces:**
- Consumes: `saveDraft` (Task 6, now `articleId`-based).

- [ ] **Step 1: Rewrite the page**

Replace the whole file:

```tsx
import { prisma } from "@/lib/prisma";
import { requireLineWriter } from "@/lib/writers/guard";
import { saveDraft, runSpecCheck, setAssetStatus } from "@/app/desk-content-actions";

export default async function WriterLine({
  params,
}: {
  params: Promise<{ locale: string; lineId: string }>;
}) {
  const { locale, lineId } = await params;
  await requireLineWriter(lineId, locale); // redirects if not assigned

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
      article: {
        select: {
          id: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              body: true,
              specPassed: true,
              reviewNotes: true,
            },
          },
        },
      },
    },
  });

  if (!line?.brief || !line.article) {
    return <main className="p-6 text-sm">No brief for this line yet.</main>;
  }

  const latest = line.article.versions[0];
  const articleId = line.article.id;

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
        <input type="hidden" name="orderId" value={line.orderId} />
        <input type="hidden" name="articleId" value={articleId} />
        <label className="block text-sm font-medium">Article</label>
        <textarea
          name="body"
          defaultValue={latest?.body ?? ""}
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
            {latest.specPassed === true
              ? " · spec ✓"
              : latest.specPassed === false
                ? " · spec ✗"
                : ""}
          </span>
          <form action={runSpecCheck}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={line.orderId} />
            <input type="hidden" name="assetId" value={latest.id} />
            <button type="submit" className="underline">
              Run spec check
            </button>
          </form>
          <form action={setAssetStatus}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={line.orderId} />
            <input type="hidden" name="assetId" value={latest.id} />
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

The only behavioral change from before: if `assignWriterToLine` (Task 5) hasn't run for this line yet, `line.article` is null and the page shows the same "No brief for this line yet" fallback it already had (previously keyed off a missing `brief`, now also keyed off a missing `article` — in practice both are always created together now, brief at order-confirmation, article at writer-assignment, so this fallback covers "writer not yet assigned").

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "writer/lines"`
Expected: no errors.

- [ ] **Step 3: Full typecheck — confirm zero remaining errors**

Run: `pnpm typecheck`
Expected: clean, no errors anywhere (this closes out the errors flagged as expected back in Task 1 Step 5).

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/writer/lines/[lineId]/page.tsx"
git commit -m "feat(content): read writer line page via linked Article"
```

---

### Task 11: Locale copy for the new `articles` namespace

**Files:**
- Modify: `src/messages/en.json`, `src/messages/no.json`, `src/messages/da.json`, `src/messages/sv.json`, `src/messages/fi.json`, `src/messages/de.json`

**Interfaces:**
- Produces: an `articles` namespace with the keys below, consumed by Tasks 12-13's pages via `getTranslations({ locale, namespace: "articles" })`.

- [ ] **Step 1: Add the `articles` namespace to every locale file**

Add a top-level `"articles": { ... }` object to each of the six files (insert alphabetically or next to `"orders"` — match whatever ordering convention that file already uses). English (`en.json`):

```json
"articles": {
  "eyebrow": "Articles",
  "title": "Your articles",
  "subtitle": "Every article for your organization, and which placement it's linked to.",
  "newArticleCta": "New article",
  "none": "No articles yet.",
  "colTitle": "Title",
  "colStatus": "Status",
  "colAuthor": "Author",
  "colPlacement": "Placement",
  "notLinked": "Not linked",
  "view": "View",
  "newHeading": "New article",
  "newTitleLabel": "Title",
  "newTitlePlaceholder": "e.g. \"Why hybrid teams need better onboarding\"",
  "createCta": "Create",
  "detailWriteHeading": "Write",
  "detailUploadHeading": "Upload a file",
  "detailUploadHint": "PDF, Word (.docx) or plain text, up to 25MB.",
  "detailSaveDraft": "Save draft",
  "detailUploading": "Uploading…",
  "detailStatus": "Status",
  "detailSpecPassed": "spec ✓",
  "detailSpecFailed": "spec ✗",
  "detailRunSpecCheck": "Run spec check",
  "detailSubmitForReview": "Submit for review",
  "detailReviewNotes": "Review notes",
  "linkHeading": "Link to a placement",
  "linkHint": "This article isn't linked to a placement yet.",
  "linkEmpty": "No unlinked placements available in your organization.",
  "linkCta": "Link",
  "linkedTo": "Linked to"
}
```

Norwegian (`no.json`):

```json
"articles": {
  "eyebrow": "Artikler",
  "title": "Dine artikler",
  "subtitle": "Alle artikler for organisasjonen din, og hvilken plassering de er koblet til.",
  "newArticleCta": "Ny artikkel",
  "none": "Ingen artikler ennå.",
  "colTitle": "Tittel",
  "colStatus": "Status",
  "colAuthor": "Forfatter",
  "colPlacement": "Plassering",
  "notLinked": "Ikke koblet",
  "view": "Åpne",
  "newHeading": "Ny artikkel",
  "newTitleLabel": "Tittel",
  "newTitlePlaceholder": "f.eks. «Hvorfor hybride team trenger bedre onboarding»",
  "createCta": "Opprett",
  "detailWriteHeading": "Skriv",
  "detailUploadHeading": "Last opp fil",
  "detailUploadHint": "PDF, Word (.docx) eller ren tekst, inntil 25MB.",
  "detailSaveDraft": "Lagre utkast",
  "detailUploading": "Laster opp…",
  "detailStatus": "Status",
  "detailSpecPassed": "spec ✓",
  "detailSpecFailed": "spec ✗",
  "detailRunSpecCheck": "Kjør spec-sjekk",
  "detailSubmitForReview": "Send til gjennomgang",
  "detailReviewNotes": "Kommentarer",
  "linkHeading": "Koble til en plassering",
  "linkHint": "Denne artikkelen er ikke koblet til en plassering ennå.",
  "linkEmpty": "Ingen ledige plasseringer i organisasjonen din.",
  "linkCta": "Koble til",
  "linkedTo": "Koblet til"
}
```

Danish (`da.json`):

```json
"articles": {
  "eyebrow": "Artikler",
  "title": "Dine artikler",
  "subtitle": "Alle artikler for din organisation, og hvilken placering de er koblet til.",
  "newArticleCta": "Ny artikel",
  "none": "Ingen artikler endnu.",
  "colTitle": "Titel",
  "colStatus": "Status",
  "colAuthor": "Forfatter",
  "colPlacement": "Placering",
  "notLinked": "Ikke koblet",
  "view": "Åbn",
  "newHeading": "Ny artikel",
  "newTitleLabel": "Titel",
  "newTitlePlaceholder": "f.eks. \"Hvorfor hybride teams har brug for bedre onboarding\"",
  "createCta": "Opret",
  "detailWriteHeading": "Skriv",
  "detailUploadHeading": "Upload en fil",
  "detailUploadHint": "PDF, Word (.docx) eller ren tekst, op til 25MB.",
  "detailSaveDraft": "Gem udkast",
  "detailUploading": "Uploader…",
  "detailStatus": "Status",
  "detailSpecPassed": "spec ✓",
  "detailSpecFailed": "spec ✗",
  "detailRunSpecCheck": "Kør spec-tjek",
  "detailSubmitForReview": "Send til gennemgang",
  "detailReviewNotes": "Kommentarer",
  "linkHeading": "Kobl til en placering",
  "linkHint": "Denne artikel er ikke koblet til en placering endnu.",
  "linkEmpty": "Ingen ledige placeringer i din organisation.",
  "linkCta": "Kobl til",
  "linkedTo": "Koblet til"
}
```

Swedish (`sv.json`):

```json
"articles": {
  "eyebrow": "Artiklar",
  "title": "Dina artiklar",
  "subtitle": "Alla artiklar för din organisation, och vilken placering de är kopplade till.",
  "newArticleCta": "Ny artikel",
  "none": "Inga artiklar ännu.",
  "colTitle": "Titel",
  "colStatus": "Status",
  "colAuthor": "Författare",
  "colPlacement": "Placering",
  "notLinked": "Inte kopplad",
  "view": "Öppna",
  "newHeading": "Ny artikel",
  "newTitleLabel": "Titel",
  "newTitlePlaceholder": "t.ex. \"Varför hybridteam behöver bättre onboarding\"",
  "createCta": "Skapa",
  "detailWriteHeading": "Skriv",
  "detailUploadHeading": "Ladda upp en fil",
  "detailUploadHint": "PDF, Word (.docx) eller ren text, upp till 25MB.",
  "detailSaveDraft": "Spara utkast",
  "detailUploading": "Laddar upp…",
  "detailStatus": "Status",
  "detailSpecPassed": "spec ✓",
  "detailSpecFailed": "spec ✗",
  "detailRunSpecCheck": "Kör specifikationskontroll",
  "detailSubmitForReview": "Skicka för granskning",
  "detailReviewNotes": "Kommentarer",
  "linkHeading": "Koppla till en placering",
  "linkHint": "Den här artikeln är inte kopplad till en placering ännu.",
  "linkEmpty": "Inga lediga placeringar i din organisation.",
  "linkCta": "Koppla",
  "linkedTo": "Kopplad till"
}
```

Finnish (`fi.json`):

```json
"articles": {
  "eyebrow": "Artikkelit",
  "title": "Artikkelisi",
  "subtitle": "Kaikki organisaatiosi artikkelit ja niiden liitetyt sijoittelut.",
  "newArticleCta": "Uusi artikkeli",
  "none": "Ei vielä artikkeleita.",
  "colTitle": "Otsikko",
  "colStatus": "Tila",
  "colAuthor": "Kirjoittaja",
  "colPlacement": "Sijoittelu",
  "notLinked": "Ei liitetty",
  "view": "Avaa",
  "newHeading": "Uusi artikkeli",
  "newTitleLabel": "Otsikko",
  "newTitlePlaceholder": "esim. \"Miksi hybriditiimit tarvitsevat paremman perehdytyksen\"",
  "createCta": "Luo",
  "detailWriteHeading": "Kirjoita",
  "detailUploadHeading": "Lataa tiedosto",
  "detailUploadHint": "PDF, Word (.docx) tai pelkkä teksti, enintään 25 Mt.",
  "detailSaveDraft": "Tallenna luonnos",
  "detailUploading": "Ladataan…",
  "detailStatus": "Tila",
  "detailSpecPassed": "spec ✓",
  "detailSpecFailed": "spec ✗",
  "detailRunSpecCheck": "Suorita spec-tarkistus",
  "detailSubmitForReview": "Lähetä tarkistettavaksi",
  "detailReviewNotes": "Kommentit",
  "linkHeading": "Liitä sijoitteluun",
  "linkHint": "Tätä artikkelia ei ole vielä liitetty sijoitteluun.",
  "linkEmpty": "Ei vapaita sijoitteluja organisaatiossasi.",
  "linkCta": "Liitä",
  "linkedTo": "Liitetty"
}
```

German (`de.json`):

```json
"articles": {
  "eyebrow": "Artikel",
  "title": "Deine Artikel",
  "subtitle": "Alle Artikel deiner Organisation und die verknüpfte Platzierung.",
  "newArticleCta": "Neuer Artikel",
  "none": "Noch keine Artikel.",
  "colTitle": "Titel",
  "colStatus": "Status",
  "colAuthor": "Autor",
  "colPlacement": "Platzierung",
  "notLinked": "Nicht verknüpft",
  "view": "Öffnen",
  "newHeading": "Neuer Artikel",
  "newTitleLabel": "Titel",
  "newTitlePlaceholder": "z. B. \"Warum hybride Teams besseres Onboarding brauchen\"",
  "createCta": "Erstellen",
  "detailWriteHeading": "Schreiben",
  "detailUploadHeading": "Datei hochladen",
  "detailUploadHint": "PDF, Word (.docx) oder reiner Text, bis zu 25MB.",
  "detailSaveDraft": "Entwurf speichern",
  "detailUploading": "Wird hochgeladen…",
  "detailStatus": "Status",
  "detailSpecPassed": "spec ✓",
  "detailSpecFailed": "spec ✗",
  "detailRunSpecCheck": "Spec-Prüfung ausführen",
  "detailSubmitForReview": "Zur Prüfung einreichen",
  "detailReviewNotes": "Anmerkungen",
  "linkHeading": "Mit einer Platzierung verknüpfen",
  "linkHint": "Dieser Artikel ist noch mit keiner Platzierung verknüpft.",
  "linkEmpty": "Keine freien Platzierungen in deiner Organisation.",
  "linkCta": "Verknüpfen",
  "linkedTo": "Verknüpft mit"
}
```

- [ ] **Step 2: Run the locale parity test**

Run: `pnpm exec tsx --test src/messages/market-labels.test.ts`
Expected: PASS — the `locale key parity` and `untranslated leak guard` suites confirm every locale has the same key set and no locale accidentally copied the English string verbatim.

- [ ] **Step 3: Commit**

```bash
git add src/messages/*.json
git commit -m "feat(i18n): add articles namespace to all locales"
```

---

### Task 12: Overview page (`/articles`)

**Files:**
- Create: `src/app/[locale]/articles/page.tsx`

**Interfaces:**
- Consumes: `loadScope` (`src/lib/scope.ts`), `StatusBadge` (`src/app/status-badge.tsx`), `EmptyState` (`src/app/empty-state.tsx`), `Link` (`@/i18n/navigation`), the `articles` i18n namespace (Task 11).

- [ ] **Step 1: Write the page**

```tsx
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { loadScope } from "@/lib/scope";
import { EmptyState } from "@/app/empty-state";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

export default async function ArticlesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "articles" });

  const scope = await loadScope();
  if (!scope.workspace) redirect(`/${locale}/signin`);

  const articles = await prisma.article.findMany({
    where: { organizationId: { in: scope.workspace.scopeOrgIds } },
    orderBy: { updatedAt: "desc" },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1, select: { status: true } },
      orderLine: {
        select: {
          orderId: true,
          productId: true,
        },
      },
    },
  });

  const productIds = articles
    .map((a) => a.orderLine?.productId)
    .filter((id): id is string => !!id);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: { select: { name: true } } },
      })
    : [];
  const titleByProductId = new Map(products.map((p) => [p.id, p.title.name]));

  const authorIds = [...new Set(articles.map((a) => a.createdByUserId))];
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const authorNameById = new Map(authors.map((u) => [u.id, u.name ?? u.email]));

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("subtitle")}</p>
      </header>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("eyebrow")}</span>
            <h2>{t("title")}</h2>
          </div>
          <Link href="/articles/new" className="btn small secondary">
            {t("newArticleCta")}
          </Link>
        </div>

        {articles.length === 0 ? (
          <EmptyState
            title={t("none")}
            primaryHref="/articles/new"
            primaryLabel={t("newArticleCta")}
          />
        ) : (
          <div className="table-wrap responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("colTitle")}</th>
                  <th>{t("colStatus")}</th>
                  <th>{t("colAuthor")}</th>
                  <th>{t("colPlacement")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => {
                  const status = a.versions[0]?.status ?? "DRAFT";
                  const placementName = a.orderLine?.productId
                    ? titleByProductId.get(a.orderLine.productId)
                    : null;
                  return (
                    <tr key={a.id}>
                      <td data-label={t("colTitle")}>
                        <Link href={`/articles/${a.id}`}>{a.title}</Link>
                      </td>
                      <td data-label={t("colStatus")}>
                        <StatusBadge value={status} />
                      </td>
                      <td data-label={t("colAuthor")}>
                        {authorNameById.get(a.createdByUserId) ?? "—"}
                      </td>
                      <td data-label={t("colPlacement")}>
                        {a.orderLine ? (
                          <Link href={`/orders/${a.orderLine.orderId}`}>
                            {placementName ?? t("colPlacement")}
                          </Link>
                        ) : (
                          <span className="badge badge-neutral">{t("notLinked")}</span>
                        )}
                      </td>
                      <td className="actions-col">
                        <Link href={`/articles/${a.id}`} className="link">
                          {t("view")}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -A2 "articles/page"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/articles/page.tsx"
git commit -m "feat(content): add buyer-facing articles overview page"
```

---

### Task 13: Create + detail pages (`/articles/new`, `/articles/[articleId]`)

**Files:**
- Create: `src/app/[locale]/articles/new/page.tsx`
- Create: `src/app/[locale]/articles/[articleId]/page.tsx`
- Create: `src/app/[locale]/articles/[articleId]/upload-form.tsx` (client component — file input needs `useState`/`fetch` for the presign-then-PUT flow)

**Interfaces:**
- Consumes: `createArticle`, `presignArticleUpload`, `linkArticleToOrderLine` (Task 9), `saveDraft`, `saveUploadedDraft`, `runSpecCheck`, `setAssetStatus` (Task 6), `requireArticleWriter` (Task 3), `approveContentAsset`, `requestContentChanges` (Task 7), `loadScope`/`canActOnOrg` (`src/lib/scope.ts`, unchanged).

**Important:** the existing `/orders/[orderId]` page renders the buyer approve/request-changes UI, but only for assets reachable through a *linked* order. An unlinked article that reaches `IN_REVIEW` has no other page — this detail page MUST also render that UI (reusing Task 7's actions and the existing `orders` namespace's `draftReviewHeading`/`draftApprove`/`draftChangesPlaceholder`/`draftSendChanges` keys, via a second `getTranslations({ locale, namespace: "orders" })` call), gated on `canActOnOrg(scope, article.organizationId)` and `latest.status === "IN_REVIEW"`, or the buyer-review path breaks for every unlinked article. Do not skip this section.

- [ ] **Step 1: Write the "new article" page**

```tsx
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadScope } from "@/lib/scope";
import { createArticle } from "@/app/article-library-actions";

export default async function NewArticlePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "articles" });

  const scope = await loadScope();
  if (!scope.workspace) redirect(`/${locale}/signin`);

  const orgs = await prisma.organization.findMany({
    where: { id: { in: scope.workspace.scopeOrgIds } },
    select: { id: true, name: true },
  });

  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-lg font-semibold">{t("newHeading")}</h1>
      <form action={createArticle} className="space-y-3">
        <input type="hidden" name="locale" value={locale} />
        {orgs.length === 1 ? (
          <input type="hidden" name="organizationId" value={orgs[0].id} />
        ) : (
          <div>
            <label className="block text-sm font-medium">Organization</label>
            <select name="organizationId" className="w-full rounded border p-2 text-sm">
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium">{t("newTitleLabel")}</label>
          <input
            type="text"
            name="title"
            placeholder={t("newTitlePlaceholder")}
            required
            className="w-full rounded border p-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded bg-black px-3 py-1.5 text-sm text-white"
        >
          {t("createCta")}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Write the upload client component**

```tsx
"use client";

import { useState } from "react";
import { presignArticleUpload, saveUploadedDraft } from "@/app/article-library-actions";

export function UploadForm({
  articleId,
  locale,
  orderId,
  saveDraftAction,
  labels,
}: {
  articleId: string;
  locale: string;
  orderId: string;
  saveDraftAction: typeof saveUploadedDraft;
  labels: { heading: string; hint: string; uploading: string; save: string };
}) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(f: File | null) {
    setFile(f);
    setKey(null);
    setError(null);
    if (!f) return;
    setBusy(true);
    try {
      const { url, key: objectKey } = await presignArticleUpload({
        articleId,
        locale,
        filename: f.name,
        contentType: f.type,
        bytes: f.size,
      });
      const res = await fetch(url, { method: "PUT", body: f, headers: { "Content-Type": f.type } });
      if (!res.ok) throw new Error(`upload_failed:${res.status}`);
      setKey(objectKey);
    } catch {
      setError("Upload failed. Try a different file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">{labels.heading}</label>
      <p className="text-xs text-gray-500">{labels.hint}</p>
      <input
        type="file"
        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <form action={saveDraftAction}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="articleId" value={articleId} />
        <input type="hidden" name="bodyUrl" value={key ?? ""} />
        <button
          type="submit"
          disabled={busy || !key}
          className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {busy ? labels.uploading : labels.save}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Write the detail page**

```tsx
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireArticleWriter } from "@/lib/writers/guard";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { StatusBadge } from "@/app/status-badge";
import { saveDraft, saveUploadedDraft, runSpecCheck, setAssetStatus } from "@/app/desk-content-actions";
import { linkArticleToOrderLine } from "@/app/article-library-actions";
import { approveContentAsset, requestContentChanges } from "@/app/content-review-actions";
import { UploadForm } from "./upload-form";

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; articleId: string }>;
}) {
  const { locale, articleId } = await params;
  const t = await getTranslations({ locale, namespace: "articles" });
  const tOrders = await getTranslations({ locale, namespace: "orders" });
  await requireArticleWriter(articleId, locale); // redirects if not allowed
  const scope = await loadScope();

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      id: true,
      title: true,
      organizationId: true,
      orderLineId: true,
      orderLine: { select: { orderId: true } },
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          body: true,
          bodyUrl: true,
          specPassed: true,
          reviewNotes: true,
        },
      },
    },
  });
  if (!article) redirect(`/${locale}/articles`);

  const latest = article.versions[0];
  const orderId = article.orderLine?.orderId ?? "";

  const eligibleLines = article.orderLineId
    ? []
    : await prisma.orderLine.findMany({
        where: {
          kind: "INVENTORY",
          article: null,
          order: { organizationId: article.organizationId },
        },
        select: { id: true, productId: true, order: { select: { id: true } } },
      });
  const productIds = eligibleLines.map((l) => l.productId).filter((id): id is string => !!id);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: { select: { name: true } } },
      })
    : [];
  const titleByProductId = new Map(products.map((p) => [p.id, p.title.name]));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">{article.title}</h1>

      {article.orderLineId ? (
        <p className="text-sm">
          {t("linkedTo")}:{" "}
          <a href={`/${locale}/orders/${orderId}`} className="underline">
            {t("colPlacement")}
          </a>
        </p>
      ) : (
        <section className="space-y-2 rounded border p-4">
          <h2 className="text-sm font-semibold">{t("linkHeading")}</h2>
          <p className="text-xs text-gray-500">{t("linkHint")}</p>
          {eligibleLines.length === 0 ? (
            <p className="text-xs text-gray-500">{t("linkEmpty")}</p>
          ) : (
            <form action={linkArticleToOrderLine} className="flex items-center gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="articleId" value={articleId} />
              <select name="orderLineId" className="rounded border p-2 text-sm">
                {eligibleLines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.productId ? titleByProductId.get(l.productId) ?? l.id : l.id}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white">
                {t("linkCta")}
              </button>
            </form>
          )}
        </section>
      )}

      <form action={saveDraft} className="space-y-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="articleId" value={articleId} />
        <label className="block text-sm font-medium">{t("detailWriteHeading")}</label>
        <textarea
          name="body"
          defaultValue={latest?.bodyUrl ? "" : (latest?.body ?? "")}
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
        orderId={orderId}
        saveDraftAction={saveUploadedDraft}
        labels={{
          heading: t("detailUploadHeading"),
          hint: t("detailUploadHint"),
          uploading: t("detailUploading"),
          save: t("detailSaveDraft"),
        }}
      />

      {latest ? (
        <div className="flex items-center gap-4 text-sm">
          <span>
            {t("detailStatus")}: <StatusBadge value={latest.status} />
            {latest.specPassed === true
              ? ` · ${t("detailSpecPassed")}`
              : latest.specPassed === false
                ? ` · ${t("detailSpecFailed")}`
                : ""}
          </span>
          <form action={runSpecCheck}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="assetId" value={latest.id} />
            <button type="submit" className="underline">
              {t("detailRunSpecCheck")}
            </button>
          </form>
          <form action={setAssetStatus}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="assetId" value={latest.id} />
            <input type="hidden" name="target" value="IN_REVIEW" />
            <button type="submit" className="underline">
              {t("detailSubmitForReview")}
            </button>
          </form>
        </div>
      ) : null}

      {latest?.reviewNotes ? (
        <p className="text-sm text-amber-700">
          {t("detailReviewNotes")}: {latest.reviewNotes}
        </p>
      ) : null}

      {latest?.status === "IN_REVIEW" && canActOnOrg(scope, article.organizationId) ? (
        <section className="space-y-2 rounded border p-4">
          <h2 className="text-sm font-semibold">{tOrders("draftReviewHeading")}</h2>
          <div className="flex items-center gap-3">
            <form action={approveContentAsset}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="assetId" value={latest.id} />
              <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white">
                {tOrders("draftApprove")}
              </button>
            </form>
            <form action={requestContentChanges} className="flex items-center gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="assetId" value={latest.id} />
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
    </main>
  );
}
```

Note: `approveContentAsset`/`requestContentChanges` (Task 7) redirect to `/${locale}/articles/${asset.article.id}` for an unlinked article (confirmed in Task 7's code above) — so after approving here, the buyer lands back on this same page and sees the updated status. `article.organizationId` is already selected in this page's `prisma.article.findUnique` query above.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: clean, zero errors across the whole project.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: clean (fix any issues the new files introduce — e.g. missing `key` props, unused imports — before proceeding).

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/articles/new/page.tsx" "src/app/[locale]/articles/[articleId]"
git commit -m "feat(content): add article create/write/upload/link detail page"
```

---

### Task 14: Fix remaining `brief`/`briefId` references across 15 read-only display files

**Context — why this task exists:** Task 1's implementer discovered that renaming `ContentAsset.briefId/brief` to `articleId/article` (and removing `ContentBrief.assets`) breaks 15 files beyond the 4 that Tasks 6, 7, 8, and 10 already fix — every one of them does `include: { brief: { include: { assets: {...} } } }` in a Prisma query and then reads `line.brief?.assets[0]` (or the `ContentAsset`-side equivalent `asset.brief.orderLine...`) to show a draft's status somewhere read-only (order detail pages, the writer roster, the publisher veto action, home page cards, etc). This task fixes all 15. It has no dependency on Tasks 2-13 — only on Task 1's schema — so it's safe to implement independently of them, but MUST land before Task 15's full-suite `pnpm typecheck` check.

**The mechanical pattern (applies to most files):** `ContentBrief` itself is unchanged and still holds `message`/`audience`/`doNotes`/`dontNotes` directly on `OrderLine.brief` — leave every reference to those fields alone. Only the **`assets`** sub-relation moved. So each fix is:
1. In the Prisma query: keep `brief: { select/include: {...} }` for any brief-owned fields (message/audience/etc.) as-is, MINUS its `assets` sub-select — and add a **sibling** `article: { include: { versions: { orderBy: { version: "desc" }, take: N } } } }` (same `take`/`orderBy` the old `assets` sub-select had) alongside it. If a query's `brief` include had *only* `assets` and nothing else, replace the whole `brief: {...}` block with `article: {...}` — don't leave an empty `brief: {}`.
2. In the code that reads it: `line.brief?.assets[0]` → `line.article?.versions[0]` (and similarly for `.assets` used as a full array, e.g. `line.brief?.assets ?? []` → `line.article?.versions ?? []`). `line.brief?.audience`/`.message`/etc. stay exactly as they are.
3. Where code descends from `ContentAsset` to its parent (`asset.brief.orderLine...`), change to `asset.article.orderLine...` — but note `Article.orderLine` is **nullable** (an article can be unlinked), unlike the old `ContentBrief.orderLine` which was always present. Add a null check where the brief believed nullability, per file below.

**Files (grouped by fix shape):**

**Group A — pure rename, `assets[0]`/`assets` read-only display, no null-safety concern** (the `OrderLine`/`Order`-side queries — an `OrderLine` you're already rendering always came from a confirmed `Order`, but the *article* linked to it may not exist yet if no writer/buyer has created one, which is exactly the same "no draft yet" case the old code already handled via `?.`):

- `src/app/[locale]/orders/[orderId]/page.tsx:34-38` — query:
  ```ts
  lines: {
    include: {
      article: {
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      },
      booking: { /* unchanged */ },
    },
  },
  ```
  Line 172: `const latest = line.brief?.assets[0];` → `const latest = line.article?.versions[0];`

- `src/app/[locale]/publisher/orders/page.tsx:60-64` — query's `brief: { include: { assets: {...} } }` → `article: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } }`.
  Lines 219-220, 232, 259, 262: every `line.brief?.assets[0]` / `line.brief.assets[0]` → `line.article?.versions[0]` / `line.article.versions[0]`.

- `src/app/[locale]/desk/orders/[orderId]/page.tsx:35` — `brief: { include: { assets: { orderBy: { version: "desc" } } } },` is the ONLY thing inside this `brief` include, but the sibling `trackedLinks`/`booking` includes at lines 36-44 stay. Add `article: { include: { versions: { orderBy: { version: "desc" } } } },` as a new sibling include next to `brief` (keep `brief` too — nothing else in this file reads `.brief.assets`, confirm via grep before removing `brief` entirely: `lines-section.tsx` and `campaign-section.tsx`, which receive `order.lines` from this query, read `line.brief.audience`/`.message`, so `brief` must stay in the include, just without `assets`). Since Prisma generates this file's `order` type inline (no named type import), no separate type file needs updating here.

- `src/lib/writers/roster.ts:25-34` — query's `brief: { select: { assets: {...} } }` → `article: { select: { versions: { orderBy: { version: "desc" }, take: 1, select: { status: true } } } }`.
  Line 41: `isAssignmentActive(line.brief?.assets[0]?.status ?? null)` → `isAssignmentActive(line.article?.versions[0]?.status ?? null)`.

- `src/app/[locale]/writer/page.tsx:32-41` — query's `brief: { select: { message: true, assets: {...} } }` — `message` is a `ContentBrief` field (stays under `brief`), `assets` moves out. Result:
  ```ts
  brief: { select: { message: true } },
  article: {
    select: {
      versions: { orderBy: { version: "desc" }, take: 1, select: { status: true } },
    },
  },
  ```
  Line 88: `line.brief?.assets[0]?.status ?? "NOT STARTED"` → `line.article?.versions[0]?.status ?? "NOT STARTED"`.

- `src/app/[locale]/requests/[id]/_components/OrderSection.tsx:53` and its type source `src/app/[locale]/requests/[id]/_components/types.ts:20-24` — in `types.ts`, the `QuoteWithOrder` type's nested `brief: { include: { assets: {...} } }` → `article: { include: { versions: { orderBy: "desc"; take: 1 } } }` (this is a `Prisma...GetPayload` type literal, not a runtime query — the actual query lives in `requests/[id]/page.tsx`, fixed below, and this type must mirror it exactly or the two go out of sync). In `OrderSection.tsx` line 53: `const asset = line.brief?.assets[0];` → `const asset = line.article?.versions[0];`.

- `src/app/[locale]/requests/[id]/page.tsx:39-43` — query's nested `brief: { include: { assets: {...} } }` (inside `quotes.order.lines`) → `article: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } }`. **Do not touch line 179's `briefSummary={request.briefSummary}`** — that's an unrelated top-level `Request.briefSummary` string field, not `ContentBrief`; grep matched it as a false positive.

- `src/app/[locale]/desk/orders/[orderId]/lines-section.tsx:29` (type) and `:73` (usage) — the `OrderForLines` type's `brief: { include: { assets: {...} } }` at line 29 has nothing else under `brief` in this type, so replace the whole line with `article: { include: { versions: { orderBy: "desc" } } };`. But this component ALSO reads `line.brief.audience`/`.message` at lines 183-198 (unchanged fields) — since the type comes from the *page's* actual query (not this file), and the page's query (Task above, `desk/orders/[orderId]/page.tsx`) keeps `brief` alongside the new `article`, update this type to keep BOTH: `brief: { select: { audience: true; message: true; doNotes: true; dontNotes: true } };` (matching exactly what `ContentBrief` fields are read in this file — check the full file for any other `line.brief.*` field reads and include those too) plus the new `article: {...}`. Line 73: `const assets = line.brief?.assets ?? [];` → `const assets = line.article?.versions ?? [];`.

- `src/app/[locale]/desk/orders/[orderId]/campaign-section.tsx:25, 45` — same shape as `lines-section.tsx`: two `Prisma...GetPayload` type literals (`LineWithBooking`, nested inside `OrderForCampaign`) each with `brief: { include: { assets: { orderBy: { version: "desc" } } } };` and nothing else under `brief`. Check this file for any `line.brief.*` (non-assets) field reads first (grep found none beyond the type declarations) — if none, replace both occurrences' `brief: {...}` entirely with `article: { include: { versions: { orderBy: { version: "desc" } } } };`. If you do find a runtime `.brief.` field read elsewhere in this file that the earlier grep missed, keep `brief` alongside `article` the same way `lines-section.tsx` does.

**Group B — needs an added null check, not just a rename** (an `Article` can be unlinked, unlike the old `ContentBrief` which always had an `orderLine`):

- `src/app/publisher-actions.ts:269-321` (`rejectAsset`) — query at 269-285: `include: { brief: { select: { orderLine: { select: { productId: true, order: { select: { id: true, organizationId: true } } } } } } }` → `include: { article: { select: { orderLine: { select: { productId: true, order: { select: { id: true, organizationId: true } } } } } } }`. Then at line 293, 320-321, `asset.brief.orderLine...` → `asset.article.orderLine...`, but `Article.orderLine` is nullable — a publisher can only veto content that's actually placed with them (an unlinked article has no publisher to veto from), so add a guard right after the existing `if (!asset) { redirect(...) }` block (line 287-289):
  ```ts
  if (!asset.article.orderLine) {
    redirect(`/${locale}/publisher/orders?veto=not-found`);
  }
  ```
  After that guard, `asset.article.orderLine` is non-null for the rest of the function (TypeScript narrows it within this function body since nothing reassigns `asset` in between — if it doesn't narrow automatically due to the property access being re-evaluated, assign `const orderLine = asset.article.orderLine;` right after the guard and use `orderLine.productId`/`orderLine.order.id`/`orderLine.order.organizationId` in place of the three later reads at lines 293, 320, 321).

- `src/app/[locale]/home/page.tsx:42-56` (`pendingContent` query) — this is the one place in this task where the fix is a genuine improvement, not just a rename: the current `where: { status: "IN_REVIEW", brief: { orderLine: { order: { organizationId: { in: orgIds } } } } }` requires an `OrderLine` to exist, which would silently exclude any unlinked (buyer-supplied, not-yet-placed) article's `IN_REVIEW` draft from ever showing up here — a real gap now that unlinked articles exist. Since `Article` carries `organizationId` directly, filter on that instead:
  ```ts
  prisma.contentAsset.findMany({
    where: { status: "IN_REVIEW", article: { organizationId: { in: orgIds } } },
    orderBy: { updatedAt: "desc" },
    take: 5,
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
  }),
  ```
  Then at lines 160-161, `c.brief.orderLine.order.id` / `c.brief.orderLine.booking?.title?.name` need null-safety since `c.article.orderLine` can now be null for an unlinked article:
  ```ts
  const orderId = c.article.orderLine?.order.id ?? null;
  const titleName = c.article.orderLine?.booking?.title?.name ?? "";
  ```
  Find where `orderId` is used below (the card's link target) and make it conditional: link to `/${locale}/orders/${orderId}` when `orderId` is non-null, otherwise `/${locale}/articles/${c.article.id}` (mirrors the same pattern Task 13's detail page and Task 6's `setAssetStatus` already use for this exact linked-vs-unlinked distinction).

- `src/app/[locale]/layout.tsx:159-162` (`contentCount` query) — same fix as `home/page.tsx`, same reasoning (unlinked articles must still count toward the "needs you" badge — the comment at line 151-153 explicitly says this count must stay in sync with the Home page's cards, which the fix above already changed):
  ```ts
  prisma.contentAsset.count({
    where: { status: "IN_REVIEW", article: { organizationId: { in: orgIds } } },
  }),
  ```

**Group C — pure field rename, no relation/null-safety change:**

- `src/lib/asset-lineage.ts:15` (`LineageNode.briefId: string`) → `articleId: string`. Lines 57 (`select: { ..., briefId: true, ... }` inside `adaptationsOf`) → `articleId: true`. (`rootOf` and `adaptationContext` don't reference `briefId` at all — leave them untouched.)

- `src/app/api/export/me/route.ts:92` — `include: { lines: { include: { brief: { include: { assets: true } }, booking: true } } }` → `include: { lines: { include: { article: { include: { versions: true } }, booking: true } } }`. Check whether the exported JSON downstream reads `.brief`/`.assets` by key name anywhere else in this file (grep this whole file for `brief`/`assets` beyond line 92 — if the response is returned as-is via `NextResponse.json(...)` with no further field access, no other change is needed since the shape just flows through).

**What to verify:**

- [ ] **Step 1: Apply every fix above.**

- [ ] **Step 2: Confirm no other file was missed**

Run: `pnpm typecheck 2>&1 | grep -B2 "error TS" | grep "\.tsx\?:" | sed -E 's/\(.*//' | sort -u`
Expected: this lists only files touched by Tasks 6, 7, 8, 9, 10 (not yet run if you're doing this task before those — that's fine, cross-check the file list against the plan's other tasks) — zero files from the 15 listed above should remain. If any of the 15 files still errors, you missed a reference in it; re-grep that file for `brief`/`Brief`/`assets` and fix what's left.

- [ ] **Step 3: Full typecheck**

Run: `pnpm typecheck`
If Tasks 6-10 haven't landed yet, errors from `desk-content-actions.ts`, `content-review-actions.ts`, `spec-check-runner.ts`, and `writer/lines/[lineId]/page.tsx` are expected (those are fixed by their own tasks) — confirm every remaining error is in exactly those 4 files and nothing else.

- [ ] **Step 4: Run the full unit suite**

Run: `pnpm test`
Expected: same pass count as before this task (this task touches no test files — it's fixing type/query shape in existing display code, behavior-preserving).

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/orders/[orderId]/page.tsx" "src/app/[locale]/publisher/orders/page.tsx" "src/app/[locale]/desk/orders/[orderId]/page.tsx" "src/app/[locale]/desk/orders/[orderId]/lines-section.tsx" "src/app/[locale]/desk/orders/[orderId]/campaign-section.tsx" "src/app/[locale]/requests/[id]/page.tsx" "src/app/[locale]/requests/[id]/_components/OrderSection.tsx" "src/app/[locale]/requests/[id]/_components/types.ts" src/lib/writers/roster.ts src/app/publisher-actions.ts "src/app/[locale]/home/page.tsx" src/lib/asset-lineage.ts "src/app/[locale]/writer/page.tsx" src/app/api/export/me/route.ts "src/app/[locale]/layout.tsx"
git commit -m "fix(content): repoint remaining brief/assets references at Article"
```

---

### Task 15: Integration test — end-to-end article library flow

**Files:**
- Create: `src/app/article-library.it.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-9 against a real local Postgres DB (per `test:it` convention, `ALLOW_LOCAL_DB=1`).

- [ ] **Step 1: Write the integration test**

Follow the existing `*.it.test.ts` conventions in the repo (check `src/lib/api/contract.it.test.ts` for the DB setup/teardown pattern used — connect via `prisma`, wrap each test in data it creates and cleans up itself). Write these cases:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { canWriteArticle } from "@/lib/writers/access";

// This suite exercises the DB-backed paths that access.ts's unit tests
// (Task 2) can't cover: Prisma relations, the unique orderLineId
// constraint, and the writer-assignment auto-creation hook (Task 5).

test("buyer can create an unlinked article, upload a file, and see it in their org's overview", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Test Org", type: "ADVERTISER" } });
  const user = await prisma.user.create({
    data: { email: `it-buyer-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id },
  });

  const article = await prisma.article.create({
    data: {
      organizationId: org.id,
      title: "Buyer-supplied piece",
      createdByUserId: user.id,
      createdByRole: "BUYER",
    },
  });
  assert.equal(article.orderLineId, null);

  const version = await prisma.contentAsset.create({
    data: { articleId: article.id, version: 1, status: "DRAFT", bodyUrl: "articles/x/2026-08-19/abc-file.pdf" },
  });
  assert.equal(version.body, null);

  const found = await prisma.article.findMany({ where: { organizationId: org.id } });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, article.id);

  await prisma.contentAsset.delete({ where: { id: version.id } });
  await prisma.article.delete({ where: { id: article.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("an order line can be linked to at most one article (unique constraint)", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Test Org 2", type: "ADVERTISER" } });
  const user = await prisma.user.create({
    data: { email: `it-buyer2-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id },
  });
  const quote = await prisma.quote.create({
    data: { organizationId: org.id, status: "ACCEPTED", currency: "EUR", total: 0 },
  });
  const order = await prisma.order.create({
    data: { organizationId: org.id, quoteId: quote.id, status: "CONFIRMED" },
  });
  const line = await prisma.orderLine.create({
    data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 },
  });

  const first = await prisma.article.create({
    data: { organizationId: org.id, title: "First", createdByUserId: user.id, createdByRole: "BUYER", orderLineId: line.id },
  });

  await assert.rejects(() =>
    prisma.article.create({
      data: { organizationId: org.id, title: "Second", createdByUserId: user.id, createdByRole: "BUYER", orderLineId: line.id },
    }),
  );

  await prisma.article.delete({ where: { id: first.id } });
  await prisma.orderLine.delete({ where: { id: line.id } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.quote.delete({ where: { id: quote.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("canWriteArticle: journalist assigned via WriterProfile.userId can write, another journalist cannot", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Test Org 3", type: "ADVERTISER" } });
  const writerUser = await prisma.user.create({
    data: { email: `it-writer-${Date.now()}@example.com`, role: "CONTENT" },
  });
  const otherWriterUser = await prisma.user.create({
    data: { email: `it-writer2-${Date.now()}@example.com`, role: "CONTENT" },
  });
  const writerProfile = await prisma.writerProfile.create({ data: { userId: writerUser.id } });

  const article = await prisma.article.create({
    data: {
      organizationId: org.id,
      title: "Journalist piece",
      createdByUserId: writerUser.id,
      createdByRole: "DESK",
      assignedWriterId: writerProfile.id,
    },
  });

  const loaded = await prisma.article.findUnique({
    where: { id: article.id },
    select: { organizationId: true, assignedWriter: { select: { userId: true } } },
  });
  assert.ok(loaded);

  assert.equal(
    canWriteArticle({
      role: "CONTENT",
      userId: writerUser.id,
      organizationId: loaded.organizationId,
      scopeOrgIds: [],
      assignedWriterUserId: loaded.assignedWriter?.userId ?? null,
    }),
    true,
  );
  assert.equal(
    canWriteArticle({
      role: "CONTENT",
      userId: otherWriterUser.id,
      organizationId: loaded.organizationId,
      scopeOrgIds: [],
      assignedWriterUserId: loaded.assignedWriter?.userId ?? null,
    }),
    false,
  );

  await prisma.article.delete({ where: { id: article.id } });
  await prisma.writerProfile.delete({ where: { id: writerProfile.id } });
  await prisma.user.delete({ where: { id: writerUser.id } });
  await prisma.user.delete({ where: { id: otherWriterUser.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});
```

- [ ] **Step 2: Run it**

Run: `ALLOW_LOCAL_DB=1 pnpm exec tsx --test src/app/article-library.it.test.ts`
Expected: PASS, 3 tests. If your local DB isn't migrated yet, run `pnpm prisma migrate dev` first (Task 1 already did this, but confirm before running).

- [ ] **Step 3: Run the full `test:it` suite to confirm no regressions**

Run: `pnpm test:it`
Expected: PASS — this also re-runs `src/lib/api/contract.it.test.ts`, catching any accidental break in unrelated flows.

- [ ] **Step 4: Run the full unit suite one more time**

Run: `pnpm test`
Expected: PASS, same or higher count than the Task-1 baseline (715 + the new tests from Tasks 2 and 4).

- [ ] **Step 5: Commit**

```bash
git add src/app/article-library.it.test.ts
git commit -m "test: add integration coverage for the article library"
```

---

## Post-implementation checklist

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:it` all pass.
- [ ] Manually walk through, in a browser against the local DB: buyer creates an unlinked article → uploads a PDF → links it to a placement it owns → desk assigns a journalist to a different line → journalist writes text on `/articles/[id]` → submits for review → buyer approves from `/orders/[id]`.
- [ ] Confirm the migration's `INSERT ... SELECT` backfill ran cleanly against a copy of production data (or a realistic seed) before this is merged to `main`, given the no-staging-gate deploy.
