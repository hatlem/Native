# Saved order lists — design

**Date:** 2026-06-17
**Status:** Approved (design); pending implementation plan

## Problem

Agencies on NativeSpin manage native-advertising buys for multiple clients. Today the
only place to assemble a buy is a single cookie-based basket (`nativespin_plan`,
`src/lib/basket.ts`): one working list at a time, ephemeral, consumed when an RFQ is
submitted. There is no way to keep several named buys side by side, organised per
client, and reuse them across campaigns. Switching from Client A to Client B means
save-clear-rebuild.

We want **persistent, named, per-client order lists**. A list is the unit you build on
and submit as an RFQ, it holds either whole publications (Titles) or specific bookable
placements (Products), and it survives submission so it can be reused for the next
project.

## Decisions (from brainstorming)

- **Primary user / scope:** agencies, per existing client-org. A list belongs to one
  client-org; reuse the existing `workspace.scopeOrgIds` / active-org mechanics. No new
  "project" entity — the list's **name** is the project/client label.
- **List item:** a list can hold **either** a Title (publication placeholder) **or** a
  Product (concrete bookable placement).
- **Flow:** the saved list **is** the RFQ unit — it replaces the single cookie basket.
  Submitting **snapshots** the list into the RFQ; it does **not** consume/delete the list.
- **Title lines at submit:** **both** paths supported — the buyer may resolve a Title line
  to a Product before submit, or leave it unresolved for the **desk to propose & price**.

## Architecture

### 1. Data model

Two new durable tables, plus one ripple change to `PlanItem`.

```prisma
model SavedList {
  id             String    @id @default(cuid())
  organizationId String                         // the client-org the list belongs to
  organization   Organization @relation(fields: [organizationId], references: [id])
  name           String    @default("Untitled list")
  note           String?
  // Brief defaults carried onto the RFQ at submit — same shape as PlanBrief.
  budget         Decimal?  @db.Decimal(12, 2)
  currency       String?
  goal           String?
  audienceNote   String?
  targetGeo      String?
  targetAudience String?
  targetContext  String?
  createdById    String?                        // user who created it (display/audit)
  archivedAt     DateTime?                       // soft-delete / archive
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  items SavedListItem[]

  @@index([organizationId])
  @@index([organizationId, archivedAt])
}

model SavedListItem {
  id        String    @id @default(cuid())
  listId    String
  list      SavedList @relation(fields: [listId], references: [id], onDelete: Cascade)
  // Exactly one of productId / titleId is set:
  //  - productId: a concrete bookable placement (orderable as-is)
  //  - titleId (productId null): a publication placeholder; the buyer may
  //    resolve it to a Product, or leave it for the desk to propose.
  productId String?
  product   Product?  @relation(fields: [productId], references: [id])
  titleId   String?
  title     Title?    @relation(fields: [titleId], references: [id])
  quantity  Int       @default(1)
  withContent    Boolean        @default(false)
  authorshipMode AuthorshipMode @default(BUYER_SUPPLIED)
  notes     String?
  sortOrder Int       @default(0)
  createdAt DateTime  @default(now())

  @@index([listId])
}
```

**Invariant:** exactly one of `productId` / `titleId` is non-null on a `SavedListItem`.
Enforced in the app layer (and, if cheap, a DB CHECK constraint).

**`PlanItem` ripple change** — to carry an unresolved Title line into the RFQ snapshot:

```prisma
model PlanItem {
  // productId becomes optional; titleId added.
  productId String?   // null when the line is a desk-propose Title placeholder
  titleId   String?   // set when productId is null
  // ...existing fields unchanged (quantity, withContent, authorshipMode, notes)
}
```

`Request` gains `sourceListId String?` (+ index) so a submitted RFQ traces back to the
list it was snapshotted from.

### 2. Replacing the cookie basket

Retire the `nativespin_plan` items-array cookie. Replace it with a lightweight
`nativespin_active_list` cookie holding **just the active list id** (per active org).
Everything "in your basket" today becomes "in your active list."

- **`src/lib/basket.ts`** is reworked (or superseded by `src/lib/lists.ts`): the read/write
  API now resolves the active `SavedList` for the active org rather than parsing a cookie
  array. `PlanBrief` defaults move onto the `SavedList` columns; the `nativespin_brief`
  cookie is retired alongside.
- **Lazy default list:** if there is no active list when the first item is added, create an
  "Untitled list" for the active org and set it active — preserves zero-friction
  "just start adding."
- **Legacy-cookie migration:** on first authenticated load post-deploy, if a legacy
  `nativespin_plan` / `nativespin_brief` cookie exists, fold its items + brief into a fresh
  list and clear the cookies. No in-flight basket is lost.
- **Auth context:** list building requires an authenticated org context. The catalog already
  requires an account, and the existing buy-gate / onboarding detour
  (`requireOnboardingBeforeBuy`) is preserved.

### 3. Entry points (add to list)

- **Catalog product card → "Add to list"** → appends a **Product** line to the active list.
- **Title / publication page → "Save publication"** → appends a **Title** line (placeholder).
- Both use server actions analogous to today's `addToPlan`, targeting the active `SavedList`.

### 4. Title lines — resolve or desk-propose

A Title line is a placeholder. On the list editor:

- **"Pick placement"** converts a Title line into a Product line (buyer chooses a concrete
  Product on that title).
- Left unresolved, the Title line is submitted to the desk as
  **"propose & price a placement in this publication."**

### 5. Submit — snapshot, not consume

`submitPlan` (`src/app/checkout-actions.ts`) becomes `submitList(listId)`:

1. Validate the list is in the caller's scope (`canActOnOrg`).
2. **Any unresolved Title line forces the RFQ path.** The instant all-firm-order fast path
   requires every line to be a price-shown FIRM **Product** (`isProductPriceShown`); a Title
   placeholder cannot be auto-priced, so its presence always routes to the desk.
3. Snapshot the list's items into a **`Plan` + `Request`** (today's immutable RFQ records,
   semantics unchanged). Product lines become `PlanItem{productId}`; unresolved Title lines
   become `PlanItem{titleId, productId: null}`. Set `Request.sourceListId = list.id`.
4. The desk auto-quote (`src/app/quote-actions.ts`) **skips** `PlanItem`s with null
   `productId` (a guard added there) and surfaces them on the desk request as manual
   "propose placement" rows. `QuoteLine.productId` is already nullable, so the quote side
   absorbs the resolved line once the desk picks a product.
5. The firm-order path (`src/lib/commerce/firm-order.ts`) only ever runs for all-Product,
   all-firm lists, so it is untouched.
6. **The list is not deleted** — it stays editable and ready to duplicate.

### 6. Surfaces (UI)

- **`/lists`** — index of saved (non-archived) lists for the active client-org: name, item
  count, last-submitted, with **rename / archive / duplicate** actions.
- **`/plan`** evolves into the **active-list editor**: rename inline, switch active list,
  edit lines (quantity, content production, notes), resolve Title → Product, edit brief
  defaults, submit.
- A **list switcher** in the plan/nav area (and reacting to the agency client switcher).

## Data flow

```
Catalog product  ──"Add to list"──▶  SavedListItem{productId}  ┐
Title page       ──"Save publication"─▶ SavedListItem{titleId} ┤
                                                                ├─▶ active SavedList (per active org)
/plan editor: edit qty / resolve title→product / brief         ┘
        │
        └── submitList(listId)
                 │  any unresolved Title line ⇒ RFQ path (no instant order)
                 ▼
            snapshot ⇒ Plan + PlanItem[]  (+ Request{sourceListId})
                 │
                 ├─ Product PlanItems ─▶ desk auto-quote prices them
                 └─ Title  PlanItems ─▶ desk "propose placement" (manual)
        (SavedList persists, reusable)
```

## Error handling & edge cases

- **Deactivated products:** when loading a list or submitting, Product lines whose product is
  no longer `active`/`bookable` are flagged in the editor and dropped from the RFQ snapshot
  (mirrors `duplicatePlan`'s "X items dropped" messaging).
- **Empty list / all-dropped:** submit is blocked with the existing `?error=1` style message.
- **Scope leakage:** all list reads/writes go through `canActOnOrg`; switching client never
  exposes another org's lists. A list id from outside scope is rejected.
- **Invariant violation:** a `SavedListItem` with both or neither of `productId`/`titleId` is
  rejected at the action layer.
- **Rate limiting:** `submitList` keeps the existing `rfqLimiter` gate per active org.
- **Commit authority:** the instant all-firm path keeps the `canCommitOnOrg` gate; the RFQ
  path stays ungated (any member may request a quote).

## Testing

- **Unit (`node:test`, `*.test.ts`):** list resolution / lazy-create; invariant enforcement
  (exactly-one-of product/title); legacy-cookie migration; submit routing (any title line ⇒
  RFQ path, all-firm products ⇒ instant order); deactivated-product drop.
- **Integration (`*.it.test.ts`, `ALLOW_LOCAL_DB=1`):** create list → add product + title →
  resolve one title → submit → assert Plan/Request snapshot has the right PlanItem shapes and
  `sourceListId`; assert the list still exists afterwards; assert title-only PlanItem is
  skipped by auto-quote.
- **Scope tests:** agency with two clients sees per-client lists; cross-org list id rejected.

## Out of scope (YAGNI)

- Cross-org list sharing; per-line approval workflow; real-time collaboration.
- Per-user private lists — lists are org-scoped, editable by anyone with org scope (same
  trust boundary as today's basket). Revisit only if requested.

## Risk notes

1. **`PlanItem` schema change is the only ripple risk** — it feeds Quotes/Orders. Blast radius
   is contained: firm-order path unaffected (all-Product only); only `quote-actions` needs a
   null-`productId` guard. Audit every `i.productId` read on `plan.items` during
   implementation.
2. **Basket retirement touches several call sites** (`plan-actions.ts`, `checkout-actions.ts`,
   `auth-actions.ts`, `/plan/page.tsx`, `api/export/me`). The legacy-cookie migration keeps it
   backward-compatible for in-flight sessions.

## Suggested implementation phases (for the plan)

1. Schema: `SavedList`, `SavedListItem`, `PlanItem.titleId`/optional `productId`,
   `Request.sourceListId` + migration.
2. List/active-list mechanics: `src/lib/lists.ts` (lazy-create, resolve active, legacy-cookie
   migration), list CRUD server actions.
3. Entry points: catalog "Add to list" + title "Save publication".
4. `/plan` active-list editor: switch / rename / edit / resolve title → product.
5. `submitList`: snapshot → Plan(+title lines) + Request; desk auto-quote guard; instant-order
   gating.
6. `/lists` index: list, rename, archive, duplicate.
