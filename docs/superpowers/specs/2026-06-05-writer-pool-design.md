# Writer pool & assignment — design spec

**Date:** 2026-06-05
**Status:** Approved (brainstorm) — ready for implementation plan

## Goal

Make it easy for freelance writers to add articles for each order. Introduce a
first-class writer identity (profile with languages, specialties, rate,
capacity), attach a **pool of candidate writers to each order**, **assign one
writer per order line**, and give writers a focused, scoped console instead of
the full desk surface.

## Context (existing system)

- `UserRole.CONTENT` already represents freelance writers. They currently land
  on `/desk` and, via `requireDeskOrContent`, can `saveDraft` → `ContentAsset`,
  run spec checks, and push a draft to `IN_REVIEW` (never approve/finalize).
- Articles are produced per `OrderLine` → `ContentBrief` → `ContentAsset`
  (versioned). `ContentAsset` has no author stamp today.
- **Gaps this spec closes:** no writer profile (languages/specialties); no link
  between writers and orders (any CONTENT user can see and edit *every* order's
  content); no assignment workflow.

Prod auto-deploys on push to `main` and runs migrations on deploy; the schema
changes here are additive/nullable and safe for that flow.

## Decisions (from brainstorm)

1. Writers are standalone freelancers (no org/publisher). Keep the `CONTENT`
   role; add a dedicated `WriterProfile` (1:1 with `User`).
2. Pool lives on the **Order** (candidates); the actual write assignment is
   **per OrderLine**, picked from the pool.
3. Profile captures **languages, specialties, rate & capacity, portfolio &
   status**.
4. Writers get a **dedicated `/writer` console** ("My assignments"), not the
   full desk console. This also fixes today's "CONTENT sees everything" leak.

## Data model

### New enums

```prisma
enum ContentLanguage { NO  SV  DA  FI  DE  EN }   // matches src/messages locales
enum LanguageProficiency { NATIVE  FLUENT  WORKING }
enum ContentTopic {
  FINANCE HEALTH TECH LIFESTYLE B2B TRAVEL FOOD CULTURE SUSTAINABILITY OTHER
}
```

Specialties are an enum for v1 (simple, filterable). If the desk later needs to
add categories itself, promote `ContentTopic` to a `Topic` table — out of scope
now (YAGNI).

### WriterProfile (1:1 with User, role = CONTENT)

```prisma
model WriterProfile {
  id                   String   @id @default(cuid())
  userId               String   @unique
  user                 User     @relation(fields: [userId], references: [id])
  bio                  String?
  ratePerArticle       Decimal? @db.Decimal(12,2)
  ratePerWord          Decimal? @db.Decimal(12,4)
  currency             String?                       // ISO; default from home market
  maxActiveAssignments Int?                          // capacity guidance
  active               Boolean  @default(true)       // left / on pause
  portfolioUrl         String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  languages       WriterLanguage[]
  specialties     WriterSpecialty[]
  poolMemberships OrderWriterPool[]
  assignedLines   OrderLine[]    @relation("LineAssignedWriter")
  authoredAssets  ContentAsset[] @relation("AssetAuthor")
}

model WriterLanguage {
  id          String              @id @default(cuid())
  writerId    String
  writer      WriterProfile       @relation(fields: [writerId], references: [id], onDelete: Cascade)
  language    ContentLanguage
  proficiency LanguageProficiency @default(FLUENT)
  @@unique([writerId, language])
}

model WriterSpecialty {
  id       String        @id @default(cuid())
  writerId String
  writer   WriterProfile @relation(fields: [writerId], references: [id], onDelete: Cascade)
  topic    ContentTopic
  @@unique([writerId, topic])
}
```

### Pool (candidates per order) + per-line assignment

```prisma
model OrderWriterPool {
  id        String        @id @default(cuid())
  orderId   String
  order     Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)
  writerId  String
  writer    WriterProfile @relation(fields: [writerId], references: [id])
  addedById String                       // desk user who added
  addedAt   DateTime      @default(now())
  @@unique([orderId, writerId])
  @@index([writerId])
}
```

Added to `OrderLine`:

```prisma
  assignedWriterId String?
  assignedWriter   WriterProfile? @relation("LineAssignedWriter", fields: [assignedWriterId], references: [id])
  assignedAt       DateTime?
  assignedById     String?
```

Added to `ContentAsset`:

```prisma
  authorWriterId String?
  authorWriter   WriterProfile? @relation("AssetAuthor", fields: [authorWriterId], references: [id])
```

`Order` gets `writerPool OrderWriterPool[]`.

**Invariant (enforced in server action, not DB):** an `OrderLine` may only be
assigned to a writer present in that order's `OrderWriterPool`. Assignment
outside the pool is rejected.

### WriterInvite (mirrors PublisherInvite)

```prisma
model WriterInvite {
  id              String    @id @default(cuid())
  email           String
  token           String    @unique
  expiresAt       DateTime
  claimedAt       DateTime?
  claimedByUserId String?
  createdBy       String
  createdAt       DateTime  @default(now())
  @@index([email])
}
```

## Assignment workflow

Pool-building and assignment apply once an order is firm (status past
`QUOTED`). On `/desk/orders/[orderId]`:

1. **Writers panel** shows the roster ranked by match score for this order.
2. Desk adds N writers to the pool.
3. Each `OrderLine` gets an "Assigned writer" dropdown limited to pool members.

**Matching is advisory.** A pure helper `src/lib/writers/match.ts` exposes
`score(writer, { language, topics })` → number. Sorting is by language overlap
first, then specialty overlap, with a capacity signal; the desk always makes the
final pick (no hard auto-assign).

**Capacity.** "Active assignment" = an `OrderLine` assigned to the writer whose
latest `ContentAsset.status` is not yet `FINAL`/`RETRACTED`. Computed on read;
over-cap shows a warning badge but does not hard-block.

## Access control (behavior change)

- `DESK` / `SUPERADMIN`: unchanged — full visibility.
- `CONTENT`: scoped. May only read/draft/spec-check/submit on an `OrderLine`
  where `assignedWriterId` equals their own `WriterProfile.id`. Pool membership
  grants *visibility* of the order; *writing* is gated on line assignment.
- New guard `requireAssignedWriter(orderLineId, locale)` wraps `saveDraft`,
  `runSpecCheck`, and `setAssetStatus` when the actor is `CONTENT`. The existing
  `requireDeskOrContent` stays for desk actors.
- Asset drafts now stamp `authorWriterId`.

**Audit** (reusing `recordAudit`): `writer.pool_add`, `writer.pool_remove`,
`line.assign`, `line.unassign`.

## UI surfaces

### A. Desk "Writers" panel — `/desk/orders/[orderId]`

New section between order summary and per-line content blocks.
- **Pool builder:** roster table (name, language chips, specialty chips,
  capacity badge, rate), sorted by match score, with Add/Remove server actions.
- **Per-line assignment:** each line's content block gains an "Assigned writer"
  dropdown limited to pool members, showing the match score inline.

### B. Writer console — `/writer` (new)

- `landingForRole` updated so `CONTENT` lands on `/writer`.
- **My assignments** (`/writer`): every `OrderLine` assigned to me, grouped by
  order — title, market/language, deadline (placement date if set), brief
  summary, current asset status.
- **Line detail** (`/writer/lines/[lineId]`): read-only brief + write surface
  (body textarea, optional "adaptation of" picker), "Run spec check", "Submit
  for review". Same actions CONTENT has today, scoped and focused. No commercial
  desk UI.
- **My profile** (`/writer/profile`): writer edits bio, languages, specialties,
  rate, capacity, portfolio URL, active toggle.
- Guard: `/writer/*` requires `role = CONTENT` (DESK/SUPERADMIN allowed for
  preview); line detail re-checks assignment via `requireAssignedWriter`.

### C. Onboarding / invites

Mirror `PublisherInvite`: superadmin/desk issues a `WriterInvite` → tokenized,
single-use, time-limited signup → on claim, create `User{role: CONTENT}` and an
empty `WriterProfile`, then redirect to `/writer/profile`.

## Migration & testing

- **One Prisma migration:** new enums; `WriterProfile`, `WriterLanguage`,
  `WriterSpecialty`, `OrderWriterPool`, `WriterInvite`; additive nullable
  columns on `OrderLine` and `ContentAsset`; `writerPool` back-relation on
  `Order`. All additive/nullable — safe for auto-deploy-on-push prod.
- **Tests (node:test, repo runner):**
  - `match.ts` scoring — language/specialty/capacity weighting and ordering.
  - `requireAssignedWriter` allow/deny matrix (assigned vs pool-only vs
    unrelated; CONTENT vs DESK).
  - Pool-membership enforcement on line assignment (reject out-of-pool).
  - `landingForRole("CONTENT")` → `/writer`.

## Out of scope (v1)

- Topic taxonomy as an editable table (enum is fine for now).
- Writer payment/invoicing automation from rate fields.
- Auto-assignment / load-balancing (matching stays advisory).
- Self-serve pool claiming by writers (desk assigns).
