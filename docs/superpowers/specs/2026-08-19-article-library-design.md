# Article library — design

Date: 2026-08-19
Status: approved, pending implementation plan

## Problem

There is currently no way to upload an article — only a plain-text textarea
(`ContentAsset.body`) written by a journalist (`CONTENT` role) or the desk,
scoped to a single order line via `saveDraft()`
(`src/app/desk-content-actions.ts:70-114`). Two gaps:

1. No file upload. `ContentAsset.bodyUrl` exists in the schema but is never
   written to anywhere in the app.
2. Only `DESK`/`SUPERADMIN`/the assigned `CONTENT` writer can create an
   article (`canWriteLine()`, `src/lib/writers/access.ts:5-15`). A `BUYER`
   who has their own material cannot supply it themselves.

Requested:
- Journalists can write text directly **or** upload a file.
- Customers (buyers) can upload their own material.
- A buyer-facing overview lists every article that exists for their
  organization, and shows which placement/campaign it's linked to — or that
  it isn't linked to anything yet.

The "not linked to anything yet" requirement means an article must be able
to exist before a placement (`OrderLine`) is chosen for it. Today that's
impossible: `ContentAsset` is always a child of `ContentBrief`, and
`ContentBrief.orderLineId` is required and unique — one brief per order
line, always attached at order-confirmation time
(`src/lib/commerce/accept-quote.ts:79-85`,
`src/lib/commerce/firm-order.ts:333-339`).

Relevant existing signal: `OrderLine.authorshipMode` already distinguishes
`BUYER_SUPPLIED` / `NATIVESPIN_PRODUCED` / `PUBLISHER_PRODUCED`
(`prisma/schema.prisma:77-81`), with a comment noting it "gates writer
staffing." The data model already anticipated that some lines get
buyer-supplied content — this feature is the missing other half.

## Chosen approach

Introduce a new `Article` model that becomes the parent of `ContentAsset`,
replacing `ContentBrief` in that role. `ContentBrief` keeps its current
shape and its current auto-creation code path
(`accept-quote.ts`/`firm-order.ts`) completely untouched — it becomes pure
guidance text (message/audience/do/don't) displayed alongside whichever
`Article` is linked to that order line, no longer the owner of asset
versions.

This was chosen over two alternatives considered:
- **Fully parallel system** (new `Article` model with its own independent
  status/review/audit logic, zero changes to the existing writer flow) —
  rejected: leaves two near-duplicate subsystems side by side.
- **Additive with a merged view** (new `Article` model, old flow untouched,
  overview page unions both sources for display) — safer (zero risk to the
  live writer flow) but also leaves duplicated status/audit/notify logic
  long-term.

The chosen approach keeps a single system. The riskiest code
(order-confirmation transactions in `accept-quote.ts`/`firm-order.ts`) is
not touched, which limits blast radius on a production app with no staging
gate.

## Data model

```prisma
model Article {
  id              String             @id @default(cuid())
  organizationId  String
  organization    Organization       @relation(fields: [organizationId], references: [id])
  title           String
  createdByUserId String
  createdByRole   UserRole
  assignedWriterId String?
  assignedWriter  WriterProfile?     @relation("ArticleAssignedWriter", fields: [assignedWriterId], references: [id])
  orderLineId     String?            @unique
  orderLine       OrderLine?         @relation(fields: [orderLineId], references: [id])
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  versions ContentAsset[]

  @@index([organizationId])
  @@index([assignedWriterId])
}
```

`ContentAsset` changes: `briefId` → `articleId` (FK now points at
`Article`, same `@@index` shape). No other field changes — `body`,
`bodyUrl`, `status`, `specPassed`, `reviewNotes`, retraction fields, and the
`sourceAssetId`/`adaptations` lineage pair are unchanged.

`ContentBrief` changes: drop the `assets ContentAsset[]` relation. Nothing
else changes — `orderLineId` stays required and unique, creation code stays
as-is.

`OrderLine` gains the inverse `article Article?` relation (via `Article.
orderLineId`), alongside its existing `brief ContentBrief?`.

## Permissions

New `canWriteArticle(scope, article)` in `src/lib/writers/access.ts`,
composing the two existing gate primitives rather than inventing new logic:

```
DESK / SUPERADMIN            → always
CONTENT (journalist)         → only if article.assignedWriterId's user === scope.userId
BUYER / APPROVER / ORG_ADMIN → only if article.organizationId is in scope.workspace.scopeOrgIds
```

Creation rules:
- A `BUYER`/`APPROVER`/`ORG_ADMIN` can self-serve create a new `Article` for
  their own organization (no assignment needed — they own the org).
- A journalist-authored `Article` is created by `DESK`/`SUPERADMIN`, who
  assign a `WriterProfile` at creation time (mirrors today's implicit
  writer-assignment flow on `OrderLine.assignedWriterId`).
- `CONTENT` never self-initiates a new `Article` — consistent with the
  existing precedent that writers only ever act on lines/articles assigned
  to them.

## Write / upload flow

Either/or per version, as today's textarea already implies one artifact per
save: a writer or buyer picks "Write" or "Upload" per save action. Allowed
upload types: PDF, DOCX, TXT — added via a new `allowedTypes` parameter on
`presignUpload()`/`putObject()`/`validateContentType()` in
`src/lib/storage/r2.ts`, rather than growing the shared type set the
rate-card flow also uses. Same client-side presign-then-PUT pattern as
`presignRateCardUpload()` (`src/app/[locale]/rate-card/[token]/actions.ts:23-44`):
a server action returns `{url, key}`, the browser PUTs directly to R2, the
returned key is submitted as `bodyUrl` on the new `ContentAsset` version.
Object key prefix: `articles/<articleId>/...`.

## Status flow and spec check

`ContentAssetStatus` transitions are unchanged (`DRAFT` → `IN_REVIEW` →
`APPROVED`/`CHANGES_REQUESTED` → `FINAL`, plus `RETRACTED`), and the same
transition rules apply regardless of who authored the version.

Spec check (`specCheck()` — word count + disclosure label) needs a
`Product`, which is only reachable via `Article.orderLine.productId`. Two
consequences, both natural rather than new complexity:
- Spec check cannot run until the `Article` is linked to a placement
  (`orderLineId` set), independent of upload vs. text.
- For uploaded files specifically, spec check is skipped even after
  linking — decided earlier or the app has no reliable way to extract
  checkable text from a PDF/DOCX today. (Note: `pdf-parse` and
  `tesseract.js` are already dependencies, unused by this feature — a
  future enhancement could extract text from uploads and run the same
  check, but that's out of scope here.)

## Overview page

New buyer-facing route (`src/app/[locale]/articles/page.tsx`), following the
exact list/table pattern of `src/app/[locale]/orders/page.tsx:58-77`:
`loadScope()` → redirect if no workspace → query
`prisma.article.findMany({ where: { organizationId: { in: scope.workspace.scopeOrgIds } } })`
→ render as a sortable table (reuse `StatusBadge`, `EmptyState`,
`.table-wrap.responsive` conventions already established there).

Columns: title, status (latest version), author, linked
placement/campaign (renders `OrderLine → Order` as a link when
`orderLineId` is set) or an "Ikke koblet" badge, and a "Koble til
plassering" action when unlinked. Linking sets `Article.orderLineId`,
enforced unique — one article per placement, the same invariant
`ContentBrief.orderLineId` already has today.

## Migration of existing data

For every existing `ContentBrief` that has `assets`:
1. Create an `Article` row — `organizationId` from `orderLine.order.
   organizationId`, `orderLineId` copied from the brief, `title` derived
   (e.g. from the linked product/title name, falling back to a truncated
   `ContentBrief.message`), `createdByUserId`/`createdByRole` from the
   earliest version's `authorWriterId` → `WriterProfile.userId` (fallback:
   a system/desk account if no author is resolvable).
2. Repoint every `ContentAsset` under that brief: `briefId` → the new
   `Article.id`.

Runs as a data-migration step inside the Prisma migration (raw SQL or a
one-off script executed as part of the same deploy), since this is a
single-push-to-prod app with no staging gate — the backfill must be
correct on the first and only run.

## Files touched

- `prisma/schema.prisma` — new `Article` model, `ContentAsset.articleId`,
  drop `ContentBrief.assets`
- new migration with data backfill (see above)
- `src/lib/writers/access.ts` / `guard.ts` — new `canWriteArticle`
- `src/lib/storage/r2.ts` — parameterize `allowedTypes`
- `src/app/desk-content-actions.ts` — repoint `saveDraft`/`setAssetStatus`/
  `runSpecCheck` at `Article` instead of `ContentBrief`; add upload variant
- `src/app/content-review-actions.ts` — repoint buyer approve/request-changes
  at `Article`
- `src/lib/spec-check-runner.ts` — read `asset.article.orderLine.productId`
  instead of `asset.brief.orderLine.productId`; no-op when unlinked or when
  the version is a file upload
- `src/app/[locale]/writer/lines/[lineId]/page.tsx` — read the line's
  linked `Article` instead of `brief.assets`
- new `src/app/[locale]/articles/page.tsx` (overview) and
  `src/app/[locale]/articles/[articleId]/page.tsx` (write/upload/review)

## Testing plan

- Unit tests for `canWriteArticle` (all role/assignment/org-scope
  combinations, mirroring existing `canWriteLine` test coverage).
- Unit tests for the migration's title-derivation and author-fallback
  logic against representative existing `ContentBrief`/`ContentAsset` rows.
- Integration test (`*.it.test.ts`) covering: buyer creates + uploads an
  unlinked article, links it to a placement, desk/writer flow still works
  end-to-end on a journalist-authored + linked article, spec check no-ops
  correctly pre-link and for uploads.
- Manual verification in the worktree against a local DB before merging,
  given the no-staging-gate deploy.

## Non-goals

- Text extraction from uploaded PDFs/DOCX for spec checking (noted above as
  a future enhancement, not built here).
- Many-to-many article-to-placement linking (one article ↔ zero-or-one
  placement, matching today's `ContentBrief` invariant).
- Changing `accept-quote.ts`/`firm-order.ts` order-confirmation behavior.
