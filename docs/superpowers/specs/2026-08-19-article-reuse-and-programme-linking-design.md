# Article reuse across placements and campaign-programme linking — design

Date: 2026-08-19
Status: approved, pending implementation plan

## Problem

The article library shipped earlier today models `Article.orderLineId` as
1:1 (unique) — one article, at most one placement, matching the invariant
`ContentBrief.orderLineId` already had. Two new requirements break that:

1. **Campaign-programme waves** (`SavedList` rows inside a
   `CampaignProgramme`, shown on `/plan` via `PlanProgramme.tsx`) currently
   have a free-text `articleAngle` field — just a string folded into the
   RFQ brief at submit time (`withWaveAngle()` in `src/lib/programme.ts`).
   It has no connection to `Article`/`ContentAsset`. The request: waves
   should link to a real `Article` instead, reusing the write/upload/create
   actions built earlier — not a second, parallel content mechanism.
2. **An article must be reusable across multiple campaigns/waves and
   multiple actual placements at once** — e.g. the same press release
   syndicated to several titles, or drafted once during planning and
   reused across several of a buyer's own bookings. This directly
   contradicts the 1:1 invariant.

Moving to "one article, many placements" is not just a schema change.
Several pieces of the system already assumed exactly one placement per
article:

- **Spec check** (word count / disclosure) checks against one product's
  requirements, reached via the article's one `orderLine`.
- **Publisher editorial veto** (retraction) is stamped once, on the shared
  `ContentAsset` row — with multiple placements, one publisher's veto
  would silently retract the article everywhere, including at publishers
  who never asked for it.
- **Redirect/notify routing** in `desk-content-actions.ts`,
  `content-review-actions.ts`, and `publisher-actions.ts` all resolve "the"
  order/orderLine off the article to decide where to send the user or who
  to notify.
- **Versioning**: once a placement's content has gone live, later edits to
  the article (for reuse elsewhere) must not retroactively change what's
  already published there.

## Chosen approach

Flip the direction of the `Article`↔`OrderLine` relationship and give it
its own small model, `ArticlePlacement`, rather than a bare FK on either
side — because the relationship now carries state of its own (spec
compliance, retraction, version lock) that belongs to neither `Article`
nor `OrderLine` alone. This mirrors the existing pattern in this schema:
`ContentBrief` and `PublisherBooking` are both already separate 1:1-with-
`OrderLine` models for their own concerns; `ArticlePlacement` is the same
shape, just many-to-one toward `Article` instead of 1:1.

Two alternatives considered and rejected:
- **A bare `OrderLine.articleId` column, no join model** — insufficient
  once spec-check/retraction/version-lock need to live per placement, not
  per article. Would immediately need migrating to a join model anyway.
- **Fork the whole DRAFT→IN_REVIEW→APPROVED→FINAL status machine to be
  per-placement** — rejected. `ContentAsset.status` is already scoped to
  one version row, not to the whole article, so the real gap is only
  "which version is a placement pinned to," not "does each placement need
  its own independent workflow." A `lockedAssetId` pointer on
  `ArticlePlacement` closes that gap without duplicating the state
  machine — see **Version locking** below.

## Data model

```prisma
model ArticlePlacement {
  id             String    @id @default(cuid())
  orderLineId    String    @unique
  orderLine      OrderLine @relation(fields: [orderLineId], references: [id])
  articleId      String
  article        Article   @relation(fields: [articleId], references: [id])
  lockedAssetId  String?
  lockedAsset    ContentAsset? @relation(fields: [lockedAssetId], references: [id])
  specPassed     Boolean?
  specNotes      String?
  retractedAt    DateTime?
  retractedBy    String?
  retractionNote String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([articleId])
}
```

- `OrderLine.articlePlacement ArticlePlacement?` (inverse — still exactly
  one link per placement, unchanged cardinality from that side).
- `Article.placements ArticlePlacement[]` (inverse — now plural: one
  article can be linked from many placements).
- `Article.orderLineId` and its unique index are **removed** — replaced
  entirely by `ArticlePlacement`.
- `ContentAsset` loses `specPassed`, `reviewNotes`'s spec-check usage,
  and the three retraction fields (`retractedAt`, `retractedBy`,
  `retractionNote`) — those move to `ArticlePlacement`. `ContentAsset`
  keeps `status` (DRAFT/IN_REVIEW/CHANGES_REQUESTED/APPROVED/FINAL) and
  `reviewNotes` (repurposed as purely the buyer's change-request note —
  it already served that dual purpose awkwardly before this change; this
  splits it cleanly). `RETRACTED` is removed from `ContentAssetStatus`
  — retraction is no longer a status value at all, it is
  `ArticlePlacement.retractedAt` being non-null.
- `SavedList.articleId String?` (new, nullable) + `article Article?`
  relation. `SavedList.articleAngle` is removed — the article's `title`
  *is* the angle now.
- `Article.savedLists SavedList[]` (inverse).

## Version locking

No new state machine. `ArticlePlacement.lockedAssetId` is the only
addition:

- While null, the placement follows the article's current latest
  `ContentAsset` version (exactly like today's single-placement behavior).
- The moment any `ContentAsset` version transitions to `FINAL`
  (`setAssetStatus`), every `ArticlePlacement` currently linked to that
  `Article` with `lockedAssetId` still null gets locked to that version's
  id, in the same transaction as the status update.
- A placement linked *after* the article already has a `FINAL` version
  locks immediately, to that current final version, at link time.
- A placement linked while the article's latest version is still mid-
  workflow (not yet `FINAL`) stays unlocked until a version reaches
  `FINAL` — same as the case above, just deferred.
- Once locked, later versions of the same article (drafted for reuse
  elsewhere) never change what an already-locked placement shows. This is
  the direct fix for "editing a live, published article must not
  retroactively change what's already running."

## Spec check — per placement

`runSpecCheckForAsset` changes from "check this asset against its one
placement's product" to "check this specific `ArticlePlacement` against
its `OrderLine`'s product, using whichever `ContentAsset` it's currently
following (its `lockedAsset` if locked, otherwise the article's latest
version)." Result (`specPassed`, `specNotes`) is written onto the
`ArticlePlacement` row, not the asset. Skipped entirely for an uploaded
file (`bodyUrl` set, no `body`) exactly as today.

`FINAL` is no longer gated on `specPassed` at all. Before this change,
`specPassed` was a property of the one shared placement, so "is this
content done" and "does it meet that one outlet's requirements" were the
same question. Once one piece of writing can serve placements with
different requirements, they're genuinely different questions: `FINAL`
now means "the desk/buyer considers this text finished," a shared
editorial decision independent of any one placement's compliance.
`specPassed` becomes purely informational per placement — visible on
each `ArticlePlacement`, never blocking. A placement whose spec check
fails on an otherwise-`FINAL`, locked version is a legitimate, visible
state (the desk can see it and commission an adaptation via the existing
`sourceAssetId` lineage mechanism for that outlet, rather than the
shared text being blocked from finishing for everyone else).

## Retraction — per placement

`rejectAsset` (publisher veto) in `publisher-actions.ts` now writes
`retractedAt`/`retractedBy`/`retractionNote` onto the specific
`ArticlePlacement` the acting publisher owns (resolved via
`ArticlePlacement.orderLine.productId → Title.publisherId`, same
authorization shape as today, just scoped one level deeper). It never
touches the shared `ContentAsset` row. A retracted placement is simply an
`ArticlePlacement` with `retractedAt` set — other placements sharing the
same article are completely unaffected.

## Warnings

Two UI warnings, both computed the same way — count sibling placements
via `article.placements` (excluding the one being acted on) and surface a
count if non-zero:

1. **Writing/uploading a new draft on an article that already has ≥1
   other linked placement**: shown on the article detail page and the
   writer page, before the save action fires (a simple confirm-style
   banner above the write/upload form — no new data fetch beyond what the
   page already loads for `article.placements`). *Does not block* — the
   user can proceed; it's informational, matching "warn, don't gate" for
   every other soft-guardrail already in this codebase (e.g. the desk's
   editorial-veto confirmation).
2. **Publisher retracting their placement when the article has ≥1 other
   *active* (non-retracted) linked placement**: shown on the retraction
   confirmation UI on the publisher orders page, so a publisher
   understands their veto is scoped to their own placement, not the whole
   article.

Per the earlier design decision, neither warning applies to an *already
live/locked* placement being independently edited or retracted elsewhere
— "already published" content is protected by version-locking (§Version
locking) and per-placement retraction scope, not by an extra warning;
the warnings exist for the *in-progress* editing/retracting case where a
person might not realize other placements are watching the same draft.

## Redirect / routing consequence

`desk-content-actions.ts`, `content-review-actions.ts`, and
`publisher-actions.ts` currently resolve "the" order to redirect to or
notify about by reading `asset.article.orderLine`. That single-valued
read no longer exists. Every one of these actions already receives its
calling context from a form (it's invoked from a specific page — the
writer's line page, the article detail page, a specific order's page,
the publisher's orders page) — so each action's redirect/notify target
becomes an explicit hidden form field carrying the relevant
`orderLineId`/`orderId` from the page that rendered the form, rather than
a lookup. This removes the ambiguity entirely rather than picking an
arbitrary "first" placement, and is consistent with how `saveLineDraft`
(added in the prior fix wave) already receives its `orderLineId`
explicitly rather than deriving it.

## PlanProgramme integration

`PlanProgramme.tsx`'s angle-edit form (`updateWaveAngle` action, backed
by `SavedList.articleAngle` + `setWaveAngle()` in `programme.ts`) is
replaced with:
- If the wave has no linked article yet: a compact "create article" entry
  point, reusing `createArticle` from `article-library-actions.ts`
  (passing the wave's own organization), landing on the same
  `/articles/[id]` detail page already built — no new write/upload UI.
- If the wave already has a linked article: a link to it plus a
  lightweight "unlink" action (clears `SavedList.articleId`).
- The wave is *not* auto-linked to the eventual `OrderLine` when its RFQ
  becomes an order — the buyer/desk links it manually via the existing
  "link to placement" flow on the article detail page, once the real
  `OrderLine` exists, exactly like any other unlinked article. This keeps
  the wave lifecycle (`programme.ts`, explicitly documented as knowing
  nothing about what happens downstream of the list→Request→Order chain)
  untouched — a hazard already flagged in that file's own comments as
  something not to couple further.

`withWaveAngle()` in `programme.ts` changes its input from the
`articleAngle` string to `wave.article?.title`, keeping the same
"Article angle (wave N of M): …" line format in the RFQ brief, omitted
entirely when the wave has no linked article yet.

## Migration

No production data depends on the removed 1:1 invariant yet — the prior
article-library work has been merged to `main` locally but not pushed,
so nothing has deployed. The migration still needs to be correct for any
local/seed data:

1. Add `ArticlePlacement` (table + FKs/indexes) and `SavedList.articleId`
   — purely additive, nothing dropped yet.
2. Backfill: for every existing `Article` with a non-null `orderLineId`,
   `INSERT` one `ArticlePlacement` row, reading `specPassed`,
   `retractedAt`/`retractedBy`/`retractionNote` from that article's
   latest `ContentAsset` version (still present at this point in the
   migration — this step must run before step 3 removes them), and
   setting `lockedAssetId` to that version's id if its status was
   `FINAL`.
3. Only now, after the backfill `INSERT` has read them: drop
   `ContentAsset.specPassed`/`retractedAt`/`retractedBy`/`retractionNote`,
   drop `RETRACTED` from `ContentAssetStatus`, and drop
   `Article.orderLineId` and its unique index. Same
   additive-then-backfill-then-drop discipline as the original
   `article_library` migration.

## Files touched

- `prisma/schema.prisma`, new migration
- `src/app/article-library-actions.ts` — `linkArticleToOrderLine` creates
  an `ArticlePlacement` instead of setting `Article.orderLineId`; gains
  `unlinkArticleFromOrderLine`
- `src/lib/writers/article.ts` — `ensureArticleForLine` redesigned: no
  longer upserts on a unique `orderLineId` on `Article`; creates/reuses an
  `ArticlePlacement` for the line instead
- `src/lib/spec-check-runner.ts` — operates per `ArticlePlacement`
- `src/app/publisher-actions.ts` — `rejectAsset` writes to the specific
  `ArticlePlacement`
- `src/app/desk-content-actions.ts`, `src/app/content-review-actions.ts`
  — redirect/notify target becomes an explicit form field, not a lookup;
  `setAssetStatus`'s FINAL transition locks sibling placements
- `src/app/[locale]/articles/page.tsx`, `.../[articleId]/page.tsx` —
  placement column/section becomes a list; write/upload forms show the
  sibling-placement warning
- `src/app/[locale]/home/page.tsx` — "needs you" card routing updated for
  the explicit-field pattern
- `src/lib/programme.ts`, `src/app/programme-actions.ts`,
  `src/app/[locale]/plan/_components/PlanProgramme.tsx` — angle→article
  swap
- `prisma/schema.prisma`'s `SavedList` model, all six locale message files
  (new copy for the create/link/unlink UI, warnings)
- `src/app/article-library.it.test.ts` — rewritten: the 1:1-unique
  assertions no longer hold; add coverage for shared-article scenarios
  (two placements, one retracted doesn't affect the other; version lock
  survives a later draft)

## Testing plan

- Integration tests: two `ArticlePlacement`s on one `Article`, confirm
  independent `specPassed`/retraction; confirm `lockedAssetId` is set on
  `FINAL` and survives a subsequent new version; confirm a placement
  linked after `FINAL` locks immediately at link time.
- Manual walkthrough: create an unlinked article, link it to two
  different placements, run spec check independently on each, retract
  one without affecting the other, verify the warning appears when
  editing a shared article and when retracting a shared placement.

## Non-goals

- Auto-linking a programme wave's article to its resulting order line —
  stays manual, via the existing link flow.
- Any UI for choosing which `ContentAsset` version a new
  `ArticlePlacement` starts from — it always follows the article's
  current latest version (or locks immediately if that's already
  `FINAL`), no version picker.
- Changing how `programme.ts`'s wave lifecycle (draft → sent → quoted →
  booked → live → done) is derived — untouched.
