# Favorites (publications) — design

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — pending implementation plan
**Branch:** `feat/favorites-publications`

## Problem

Buyers browsing the catalog have no lightweight way to collect publications
they're interested in. Today the only "save a title" action is the detail-page
**Save publication** button, which adds the title to the active **plan** as a
desk-resolved placeholder line — a *buying* action that mixes "things I might
want to look at again" with "things I'm planning to buy and have priced."

There is no personal shortlist, and no way to find "all the publications I like"
in one place.

## Goal

A **Favorites** surface for **publications (titles)**:

- One-tap **heart** on catalog cards and the title detail page collects a
  publication into the user's flat **Favorites** pool.
- A small dropdown next to the heart lets the user also drop the publication
  into a named **favorites list** (or create one).
- A **/favorites** page to revisit everything: the flat pool, the user's named
  lists, and lists teammates have shared.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| What can be favorited | **Publications (titles) only** — never products |
| Ownership | **Personal** to each user; a *list* is opt-in **shareable with the org** (read-only for teammates) |
| Card interaction | **Heart toggle** (→ flat Favorites) **+ a caret dropdown** to add to a specific list |
| Purpose | **Discovery/shortlist only.** From a favorited publication the user clicks into its catalog page and adds products to a plan exactly as today. **No** bridge from favorites into plans/RFQ. |
| Existing "Save publication" button | **Keep, relabel** → "Add to plan for pricing", so the buying action reads distinctly from the heart. The desk-resolution placeholder flow is unchanged. |
| Storage approach | **New dedicated models**, kept separate from `SavedList` (which is org-scoped and carries RFQ/Request relations + pricing invariants). |

## Non-goals

- No favoriting of individual products/formats.
- No "start a plan from a favorites list" bridge.
- No edit access for teammates on a shared list (read-only share only).
- No reordering UI beyond a simple `sortOrder` (drag-reorder can come later).

## Data model

Three new tables. `userId` is the owner; titles-only; no money/RFQ semantics.

```prisma
model Favorite {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  titleId   String
  title     Title    @relation(fields: [titleId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  listItems FavoriteListItem[]

  @@unique([userId, titleId])   // a title is hearted at most once per user
  @@index([userId, createdAt])
}

model FavoriteList {
  id             String       @id @default(cuid())
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organizationId String?      // sharing scope; null only if the user has no org
  organization   Organization? @relation(fields: [organizationId], references: [id])
  name           String       @default("Untitled list")
  sharedWithOrg  Boolean      @default(false)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  items FavoriteListItem[]

  @@index([userId])
  @@index([organizationId, sharedWithOrg])
}

model FavoriteListItem {
  id         String       @id @default(cuid())
  listId     String
  list       FavoriteList @relation(fields: [listId], references: [id], onDelete: Cascade)
  favoriteId String
  favorite   Favorite     @relation(fields: [favoriteId], references: [id], onDelete: Cascade)
  sortOrder  Int          @default(0)
  createdAt  DateTime     @default(now())

  @@unique([listId, favoriteId])
  @@index([listId, sortOrder])
}
```

Back-relations added to `User` (`favorites`, `favoriteLists`), `Title`
(`favorites`), and `Organization` (`favoriteLists`).

**Invariants**

- The flat "All favorites" view = the user's `Favorite` rows.
- A list item references a `Favorite` (not a `Title`), so **list membership is
  always a subset of the heart pool**. Adding a title to a list first ensures a
  `Favorite` exists.
- **Un-hearting cascades**: deleting a `Favorite` removes it from every list
  (FK `onDelete: Cascade`).
- Sharing: a `FavoriteList` with `sharedWithOrg = true` is readable by any user
  in the same `organizationId`; only the owner (`userId`) can mutate it.

## Server actions

`src/app/favorites-actions.ts` (`"use server"`). All require `session.user`;
all mutations scope by `userId`. Idempotent — unique constraints make
double-clicks safe.

| Action | Behaviour |
|---|---|
| `toggleFavorite({ titleId, locale })` | Upsert/delete the `Favorite` for the current user+title. Validates the title exists and is visible. Returns the new state. |
| `addFavoriteToList({ titleId, listId })` | Ensure `Favorite` exists, then upsert `FavoriteListItem`. |
| `removeFavoriteFromList({ listId, favoriteId })` | Delete the membership row (keeps the `Favorite`). |
| `createFavoriteList({ name })` | Create a list owned by the user, scoped to their org. Returns id. |
| `renameFavoriteList({ listId, name })` | Owner-only. |
| `deleteFavoriteList({ listId })` | Owner-only; cascades its items. |
| `setFavoriteListShared({ listId, shared })` | Owner-only; flips `sharedWithOrg`. |

Ownership guard (`requireOwnFavoriteList`) used by every list mutation; reads of
a shared list check `organizationId` match.

## UI surfaces

### Heart control — `FavoriteButton` (client component)
- Rendered on each **catalog card** (`src/app/[locale]/catalog/_components/CatalogResults.tsx`) and the **title detail page** header (`src/app/[locale]/catalog/[slug]/page.tsx`).
- One tap toggles the heart with optimistic UI (`useOptimistic` / `useTransition` calling `toggleFavorite`).
- A caret button opens a small menu: the user's lists (checkbox to add/remove) + "New list…".
- Filled vs empty state driven by server data (below).

### Detail page
- Relabel `catalog.savePublication` → "Add to plan for pricing" (string + help text only; the action `saveTitleToList` is unchanged).
- Add the `FavoriteButton` to the identity column header.

### `/favorites` page — `src/app/[locale]/favorites/page.tsx`
- **All favorites** — grid of favorited publications (reuse the catalog card), each linking to its detail page; filled heart untoggles.
- **Your lists** — named lists with item counts; create / rename / delete; per-list **Share with org** toggle; open a list to view its publications and add/remove.
- **Shared with you** — lists teammates in the same org shared (`sharedWithOrg`), read-only.
- Empty state when the user has no favorites yet: a line pointing to the catalog.

### Nav
- Add `{ key: "favorites", label: t("favorites"), href: "/favorites" }` to the **advertiser** and **agency** audiences in `src/lib/nav.ts`, beside `/lists`.

## Supporting query

Catalog browse + detail pages fetch the current user's favorited `titleId` set
for the titles on the page (one `Favorite.findMany({ where: { userId, titleId: { in } }, select: { titleId } })` per render) so hearts render filled vs empty. The
`/favorites` page loads the user's favorites, lists, and same-org shared lists.

## Error handling

- Actions idempotent; unique constraints absorb double-submits (upsert / no-op).
- Favoriting a missing/inactive/invisible title → no-op (validate first).
- Mutating a list you don't own, or reading a non-shared list from another org →
  redirect/404, no data leak.
- No active org (list `organizationId` null): personal favorites still work;
  sharing is simply unavailable until the user has an org.

## Testing

**Integration** (`node:test`, gated IT pattern):
- `toggleFavorite` idempotency (heart twice = one row; toggle removes).
- `addFavoriteToList` auto-creates the `Favorite` when missing.
- Un-hearting a title removes it from every list (cascade).
- Unique constraints: same title not double-hearted; same favorite not added to a list twice.
- Share visibility: owner mutates; same-org teammate reads a shared list; outsider denied; non-shared list invisible to teammates.

**E2E** (Playwright):
- Heart a publication from a catalog card → it appears under **All favorites**.
- Create a list, add a publication, toggle **Share with org**.

## i18n

- New `favorites` namespace in `src/messages/en.json` (English-first), then
  translated to `no/da/sv/fi/de`.
- Relabel `catalog.savePublication` (+ its help string).
- Add `nav.favorites`.

## Migration / deploy notes

- Single Prisma migration adding the three tables + indexes. Additive only — no
  changes to existing tables beyond new back-relations (no column changes).
- `main` auto-deploys to prod and runs migrations on deploy; the migration is
  purely additive and safe.
