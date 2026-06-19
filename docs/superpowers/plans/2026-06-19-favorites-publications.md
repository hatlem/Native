# Favorites (publications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a personal "Favorites" surface for publications (titles): a heart toggle on catalog cards + detail page, optional named favorites lists (shareable with the org), and a `/favorites` page to revisit them.

**Architecture:** Three new Prisma tables (`Favorite`, `FavoriteList`, `FavoriteListItem`) owned by `userId`, kept entirely separate from the org-scoped `SavedList`/RFQ model. A thin data layer (`src/lib/favorites.ts`) holds all DB logic and is covered by `node:test` integration tests. Server actions (`src/app/favorites-actions.ts`) wrap the lib with auth + form parsing. A client `FavoriteButton` island renders the heart + "add to list" menu with optimistic UI; the `/favorites` page mirrors the existing `/lists` server-page → client-component shape.

**Tech Stack:** Next.js App Router (RSC + server actions), Prisma/PostgreSQL, next-intl, `node:test` + `tsx`, Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-06-19-favorites-publications-design.md`

**Conventions in this repo (read before starting):**
- Migrations are **hand-authored SQL** under `prisma/migrations/<timestamp>_<name>/migration.sql` (no `migrate dev`). Apply locally with `pnpm prisma:deploy`; prod runs `prisma migrate deploy` on the `start` script at deploy.
- Unit tests: `pnpm test` (runs `*.test.ts`). Integration tests needing a DB: `pnpm test:it` (runs `*.it.test.ts` with `ALLOW_LOCAL_DB=1`). Both use `node:test` + `tsx`, **not** Vitest/Jest.
- Source language is English: add strings to `src/messages/en.json` first, then translate to `no/da/sv/fi/de`.
- Catalog requires an account, so `session.user` is always present on these pages.

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (add 3 models + back-relations on `User`, `Title`, `Organization`)
- Create: `prisma/migrations/20260619000000_favorites/migration.sql`

- [ ] **Step 1: Add the three models to `prisma/schema.prisma`**

Add at the end of the model section:

```prisma
model Favorite {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  titleId   String
  title     Title    @relation(fields: [titleId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  listItems FavoriteListItem[]

  @@unique([userId, titleId])
  @@index([userId, createdAt])
}

model FavoriteList {
  id             String        @id @default(cuid())
  userId         String
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  organizationId String?
  organization   Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)
  name           String        @default("Untitled list")
  sharedWithOrg  Boolean       @default(false)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

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

- [ ] **Step 2: Add back-relations to existing models**

In `model User { ... }`, add to the relation block:
```prisma
  favorites     Favorite[]
  favoriteLists FavoriteList[]
```

In `model Title { ... }`, add:
```prisma
  favorites Favorite[]
```

In `model Organization { ... }`, add:
```prisma
  favoriteLists FavoriteList[]
```

- [ ] **Step 3: Write the migration SQL**

Create `prisma/migrations/20260619000000_favorites/migration.sql`:

```sql
-- Favorites: personal publication shortlists, optionally shared with the org.
-- Additive only — three new tables + indexes; no changes to existing tables.

CREATE TABLE "Favorite" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "titleId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FavoriteList" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "organizationId" TEXT,
  "name"           TEXT NOT NULL DEFAULT 'Untitled list',
  "sharedWithOrg"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FavoriteList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FavoriteListItem" (
  "id"         TEXT NOT NULL,
  "listId"     TEXT NOT NULL,
  "favoriteId" TEXT NOT NULL,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FavoriteListItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Favorite_userId_titleId_key" ON "Favorite"("userId", "titleId");
CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId", "createdAt");
CREATE INDEX "FavoriteList_userId_idx" ON "FavoriteList"("userId");
CREATE INDEX "FavoriteList_organizationId_sharedWithOrg_idx" ON "FavoriteList"("organizationId", "sharedWithOrg");
CREATE UNIQUE INDEX "FavoriteListItem_listId_favoriteId_key" ON "FavoriteListItem"("listId", "favoriteId");
CREATE INDEX "FavoriteListItem_listId_sortOrder_idx" ON "FavoriteListItem"("listId", "sortOrder");

ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteList" ADD CONSTRAINT "FavoriteList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteList" ADD CONSTRAINT "FavoriteList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FavoriteListItem" ADD CONSTRAINT "FavoriteListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "FavoriteList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteListItem" ADD CONSTRAINT "FavoriteListItem_favoriteId_fkey" FOREIGN KEY ("favoriteId") REFERENCES "Favorite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Generate the client and apply the migration**

Run: `pnpm prisma:generate && pnpm prisma:deploy`
Expected: client regenerates with `prisma.favorite` / `prisma.favoriteList` / `prisma.favoriteListItem`; migration applies cleanly (`Applying migration 20260619000000_favorites`). If the local DB is unavailable, at minimum `pnpm prisma:generate` must succeed so types exist for the next tasks.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (new models are referenced nowhere yet; this just confirms the schema/client are valid).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260619000000_favorites
git commit -m "feat(favorites): add Favorite/FavoriteList schema + migration"
```

---

### Task 2: Data layer (`src/lib/favorites.ts`) — TDD

All DB logic lives here so actions stay thin and the logic is testable. Ownership is enforced in the lib (every list mutation verifies `list.userId === userId`).

**Files:**
- Create: `src/lib/favorites.ts`
- Test: `src/lib/favorites.it.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `src/lib/favorites.it.test.ts` (mirrors the `lists.it.test.ts` setup/teardown style):

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import {
  toggleFavorite,
  addFavoriteToList,
  removeFavoriteFromList,
  createFavoriteList,
  renameFavoriteList,
  deleteFavoriteList,
  setFavoriteListShared,
  getFavoritedTitleIds,
  getFavoritesOverview,
} from "./favorites";

let orgId = "";
let otherOrgId = "";
let userId = "";
let mateId = "";
let outsiderId = "";
let titleId = "";
let titleId2 = "";

before(async () => {
  const market = await prisma.market.findFirst();
  const code = market?.code ?? "NO";
  const org = await prisma.organization.create({ data: { name: "Fav IT Org", type: "AGENCY", marketCode: code } });
  const other = await prisma.organization.create({ data: { name: "Fav IT Other", type: "AGENCY", marketCode: code } });
  orgId = org.id;
  otherOrgId = other.id;
  const u = await prisma.user.create({ data: { email: `fav-it-${org.id}@example.com`, organizationId: orgId } });
  const m = await prisma.user.create({ data: { email: `fav-it-mate-${org.id}@example.com`, organizationId: orgId } });
  const o = await prisma.user.create({ data: { email: `fav-it-out-${org.id}@example.com`, organizationId: otherOrgId } });
  userId = u.id; mateId = m.id; outsiderId = o.id;
  const titles = await prisma.title.findMany({ where: { active: true }, select: { id: true }, take: 2 });
  titleId = titles[0].id;
  titleId2 = titles[1].id;
});

after(async () => {
  await prisma.favoriteList.deleteMany({ where: { userId: { in: [userId, mateId, outsiderId] } } });
  await prisma.favorite.deleteMany({ where: { userId: { in: [userId, mateId, outsiderId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, mateId, outsiderId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
});

test("toggleFavorite is idempotent: hearts once, then removes", async () => {
  const a = await toggleFavorite(userId, titleId);
  assert.equal(a.favorited, true);
  const count1 = await prisma.favorite.count({ where: { userId, titleId } });
  assert.equal(count1, 1);
  const b = await toggleFavorite(userId, titleId);
  assert.equal(b.favorited, false);
  const count2 = await prisma.favorite.count({ where: { userId, titleId } });
  assert.equal(count2, 0);
});

test("toggleFavorite on an unknown title is a no-op", async () => {
  const r = await toggleFavorite(userId, "does-not-exist");
  assert.equal(r.favorited, false);
});

test("addFavoriteToList auto-creates the Favorite when missing", async () => {
  const list = await createFavoriteList(userId, orgId, "B2B picks");
  await addFavoriteToList(userId, titleId, list.id);
  const fav = await prisma.favorite.findUnique({ where: { userId_titleId: { userId, titleId } } });
  assert.ok(fav, "favorite created");
  const items = await prisma.favoriteListItem.count({ where: { listId: list.id } });
  assert.equal(items, 1);
  // idempotent: adding again does not duplicate
  await addFavoriteToList(userId, titleId, list.id);
  assert.equal(await prisma.favoriteListItem.count({ where: { listId: list.id } }), 1);
});

test("un-hearting a title cascades it out of every list", async () => {
  const list = await createFavoriteList(userId, orgId, "Cascade list");
  await addFavoriteToList(userId, titleId2, list.id);
  assert.equal(await prisma.favoriteListItem.count({ where: { listId: list.id } }), 1);
  await toggleFavorite(userId, titleId2); // un-heart (it is currently favorited)
  assert.equal(await prisma.favorite.count({ where: { userId, titleId: titleId2 } }), 0);
  assert.equal(await prisma.favoriteListItem.count({ where: { listId: list.id } }), 0);
});

test("list mutations reject a non-owner", async () => {
  const list = await createFavoriteList(userId, orgId, "Owner only");
  await assert.rejects(() => renameFavoriteList(mateId, list.id, "hijack"));
  await assert.rejects(() => deleteFavoriteList(mateId, list.id));
  await assert.rejects(() => setFavoriteListShared(mateId, list.id, true));
});

test("shared lists are visible to same-org mates, not outsiders", async () => {
  const list = await createFavoriteList(userId, orgId, "Shared picks");
  await addFavoriteToList(userId, titleId, list.id);
  await setFavoriteListShared(userId, list.id, true);
  const mateView = await getFavoritesOverview(mateId, orgId);
  assert.ok(mateView.sharedLists.some((l) => l.id === list.id), "mate sees shared list");
  const outsiderView = await getFavoritesOverview(outsiderId, otherOrgId);
  assert.ok(!outsiderView.sharedLists.some((l) => l.id === list.id), "outsider does not");
  // owner does not see their own list under sharedLists (it is under `lists`)
  const ownerView = await getFavoritesOverview(userId, orgId);
  assert.ok(ownerView.lists.some((l) => l.id === list.id));
  assert.ok(!ownerView.sharedLists.some((l) => l.id === list.id));
});

test("getFavoritedTitleIds returns only this user's hearts for the given titles", async () => {
  await toggleFavorite(userId, titleId); // heart it
  const ids = await getFavoritedTitleIds(userId, [titleId, titleId2]);
  assert.ok(ids.has(titleId));
  assert.ok(!ids.has(titleId2));
  await toggleFavorite(userId, titleId); // clean up heart
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test:it`
Expected: FAIL — `Cannot find module './favorites'` (the lib does not exist yet).

- [ ] **Step 3: Implement `src/lib/favorites.ts`**

```ts
import { prisma } from "./prisma";

export type FavoritePublication = {
  favoriteId: string;
  titleId: string;
  titleName: string;
  slug: string;
  publisherName: string;
  marketCode: string;
};

export type FavoriteListSummary = {
  id: string;
  name: string;
  sharedWithOrg: boolean;
  itemCount: number;
  ownerName: string | null;
};

export type FavoritesOverview = {
  favorites: FavoritePublication[];
  lists: FavoriteListSummary[];
  sharedLists: FavoriteListSummary[];
};

/** Heart / un-heart a title for a user. Idempotent: returns the resulting
 *  state. A missing/inactive title is a no-op (returns favorited:false). */
export async function toggleFavorite(
  userId: string,
  titleId: string,
): Promise<{ favorited: boolean }> {
  const existing = await prisma.favorite.findUnique({
    where: { userId_titleId: { userId, titleId } },
    select: { id: true },
  });
  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    return { favorited: false };
  }
  const title = await prisma.title.findFirst({
    where: { id: titleId, active: true },
    select: { id: true },
  });
  if (!title) return { favorited: false };
  await prisma.favorite.create({ data: { userId, titleId } });
  return { favorited: true };
}

/** Ensure the user owns the list, returning it or throwing. */
async function requireOwnList(userId: string, listId: string) {
  const list = await prisma.favoriteList.findUnique({
    where: { id: listId },
    select: { id: true, userId: true },
  });
  if (!list || list.userId !== userId) {
    throw new Error("favorite list not found for user");
  }
  return list;
}

/** Add a title to a named list, creating the Favorite first if needed.
 *  Idempotent on (list, favorite). Verifies list ownership. */
export async function addFavoriteToList(
  userId: string,
  titleId: string,
  listId: string,
): Promise<void> {
  await requireOwnList(userId, listId);
  const title = await prisma.title.findFirst({
    where: { id: titleId, active: true },
    select: { id: true },
  });
  if (!title) return;
  const favorite = await prisma.favorite.upsert({
    where: { userId_titleId: { userId, titleId } },
    create: { userId, titleId },
    update: {},
    select: { id: true },
  });
  await prisma.favoriteListItem.upsert({
    where: { listId_favoriteId: { listId, favoriteId: favorite.id } },
    create: { listId, favoriteId: favorite.id },
    update: {},
  });
}

/** Remove a favorite from a list (keeps the heart). Verifies ownership. */
export async function removeFavoriteFromList(
  userId: string,
  listId: string,
  favoriteId: string,
): Promise<void> {
  await requireOwnList(userId, listId);
  await prisma.favoriteListItem.deleteMany({ where: { listId, favoriteId } });
}

export async function createFavoriteList(
  userId: string,
  organizationId: string | null,
  name: string,
): Promise<{ id: string }> {
  const clean = name.trim().slice(0, 80) || "Untitled list";
  const list = await prisma.favoriteList.create({
    data: { userId, organizationId, name: clean },
    select: { id: true },
  });
  return list;
}

export async function renameFavoriteList(
  userId: string,
  listId: string,
  name: string,
): Promise<void> {
  await requireOwnList(userId, listId);
  const clean = name.trim().slice(0, 80) || "Untitled list";
  await prisma.favoriteList.update({ where: { id: listId }, data: { name: clean } });
}

export async function deleteFavoriteList(
  userId: string,
  listId: string,
): Promise<void> {
  await requireOwnList(userId, listId);
  await prisma.favoriteList.delete({ where: { id: listId } });
}

export async function setFavoriteListShared(
  userId: string,
  listId: string,
  shared: boolean,
): Promise<void> {
  await requireOwnList(userId, listId);
  await prisma.favoriteList.update({
    where: { id: listId },
    data: { sharedWithOrg: shared },
  });
}

/** Which of the given titles has this user hearted? (Filled-heart rendering.)
 *  Pass the page's title ids to keep the query bounded. */
export async function getFavoritedTitleIds(
  userId: string,
  titleIds: string[],
): Promise<Set<string>> {
  if (titleIds.length === 0) return new Set();
  const rows = await prisma.favorite.findMany({
    where: { userId, titleId: { in: titleIds } },
    select: { titleId: true },
  });
  return new Set(rows.map((r) => r.titleId));
}

function toListSummary(l: {
  id: string;
  name: string;
  sharedWithOrg: boolean;
  _count: { items: number };
  user?: { name: string | null; email: string } | null;
}): FavoriteListSummary {
  return {
    id: l.id,
    name: l.name,
    sharedWithOrg: l.sharedWithOrg,
    itemCount: l._count.items,
    ownerName: l.user ? (l.user.name ?? l.user.email) : null,
  };
}

/** Everything the /favorites page needs: the flat pool, the user's own lists,
 *  and same-org lists teammates have shared. */
export async function getFavoritesOverview(
  userId: string,
  organizationId: string | null,
): Promise<FavoritesOverview> {
  const [favRows, ownLists, sharedRows] = await Promise.all([
    prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        titleId: true,
        title: {
          select: {
            name: true,
            slug: true,
            market: { select: { code: true } },
            publisher: { select: { name: true } },
          },
        },
      },
    }),
    prisma.favoriteList.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, sharedWithOrg: true, _count: { select: { items: true } } },
    }),
    organizationId
      ? prisma.favoriteList.findMany({
          where: { organizationId, sharedWithOrg: true, userId: { not: userId } },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            name: true,
            sharedWithOrg: true,
            _count: { select: { items: true } },
            user: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    favorites: favRows.map((f) => ({
      favoriteId: f.id,
      titleId: f.titleId,
      titleName: f.title.name,
      slug: f.title.slug,
      publisherName: f.title.publisher.name,
      marketCode: f.title.market.code,
    })),
    lists: ownLists.map(toListSummary),
    sharedLists: sharedRows.map(toListSummary),
  };
}

/** Load one list with its publications, for the list-detail view. Returns null
 *  if the viewer may not see it (not owner and not a shared same-org list). */
export async function getFavoriteListDetail(
  viewerId: string,
  viewerOrgId: string | null,
  listId: string,
): Promise<{
  id: string;
  name: string;
  sharedWithOrg: boolean;
  isOwner: boolean;
  items: FavoritePublication[];
} | null> {
  const list = await prisma.favoriteList.findUnique({
    where: { id: listId },
    select: {
      id: true,
      name: true,
      sharedWithOrg: true,
      userId: true,
      organizationId: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          favorite: {
            select: {
              id: true,
              titleId: true,
              title: {
                select: {
                  name: true,
                  slug: true,
                  market: { select: { code: true } },
                  publisher: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!list) return null;
  const isOwner = list.userId === viewerId;
  const sharedToViewer =
    list.sharedWithOrg && !!viewerOrgId && list.organizationId === viewerOrgId;
  if (!isOwner && !sharedToViewer) return null;
  return {
    id: list.id,
    name: list.name,
    sharedWithOrg: list.sharedWithOrg,
    isOwner,
    items: list.items.map((i) => ({
      favoriteId: i.favorite.id,
      titleId: i.favorite.titleId,
      titleName: i.favorite.title.name,
      slug: i.favorite.title.slug,
      publisherName: i.favorite.title.publisher.name,
      marketCode: i.favorite.title.market.code,
    })),
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test:it`
Expected: PASS — all `favorites.it.test.ts` tests green.
(If the local DB is unavailable, this task's tests run in CI; verify `pnpm typecheck` passes locally instead and note the IT run is deferred to CI.)

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck` (Expected: PASS)
```bash
git add src/lib/favorites.ts src/lib/favorites.it.test.ts
git commit -m "feat(favorites): data layer + integration tests"
```

---

### Task 3: Server actions (`src/app/favorites-actions.ts`)

Thin `"use server"` wrappers: parse form data, resolve the session user + org, call the lib, then `revalidatePath`. `toggleFavorite`/`addFavoriteToList` are called from the catalog/detail pages and the favorites page; they `revalidatePath` rather than redirect so the heart stays in place.

**Files:**
- Create: `src/app/favorites-actions.ts`
- Reference: `src/lib/scope.ts` (`loadScope`), `src/app/list-actions.ts` (form-parsing `str` helper pattern)

- [ ] **Step 1: Implement the actions module**

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadScope } from "@/lib/scope";
import {
  toggleFavorite as toggleFavoriteLib,
  addFavoriteToList as addFavoriteToListLib,
  removeFavoriteFromList as removeFavoriteFromListLib,
  createFavoriteList as createFavoriteListLib,
  renameFavoriteList as renameFavoriteListLib,
  deleteFavoriteList as deleteFavoriteListLib,
  setFavoriteListShared as setFavoriteListSharedLib,
} from "@/lib/favorites";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Resolve the signed-in user, redirecting to sign-in if absent. */
async function requireUser(locale: string) {
  const scope = await loadScope();
  if (!scope.userId) redirect(`/${locale}/signin`);
  return scope;
}

export async function toggleFavorite(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const titleId = str(formData, "titleId");
  const scope = await requireUser(locale);
  if (titleId) await toggleFavoriteLib(scope.userId!, titleId);
  // Revalidate wherever a heart may render. `path` form keeps it cheap.
  revalidatePath(`/${locale}/catalog`, "page");
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function addFavoriteToList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const titleId = str(formData, "titleId");
  const listId = str(formData, "listId");
  const scope = await requireUser(locale);
  if (titleId && listId) {
    await addFavoriteToListLib(scope.userId!, titleId, listId).catch(() => {});
  }
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function removeFavoriteFromList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const favoriteId = str(formData, "favoriteId");
  const scope = await requireUser(locale);
  if (listId && favoriteId) {
    await removeFavoriteFromListLib(scope.userId!, listId, favoriteId).catch(() => {});
  }
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function createFavoriteList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const name = str(formData, "name");
  const titleId = str(formData, "titleId"); // optional: add this title on create
  const scope = await requireUser(locale);
  const orgId = scope.workspace?.activeOrgId ?? null;
  const list = await createFavoriteListLib(scope.userId!, orgId, name || "Untitled list");
  if (titleId) {
    await addFavoriteToListLib(scope.userId!, titleId, list.id).catch(() => {});
  }
  revalidatePath(`/${locale}/catalog`, "page");
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function renameFavoriteList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const name = str(formData, "name");
  const scope = await requireUser(locale);
  if (listId) await renameFavoriteListLib(scope.userId!, listId, name).catch(() => {});
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function deleteFavoriteList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const scope = await requireUser(locale);
  if (listId) await deleteFavoriteListLib(scope.userId!, listId).catch(() => {});
  redirect(`/${locale}/favorites`);
}

export async function setFavoriteListShared(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const shared = str(formData, "shared") === "1";
  const scope = await requireUser(locale);
  if (listId) await setFavoriteListSharedLib(scope.userId!, listId, shared).catch(() => {});
  revalidatePath(`/${locale}/favorites`, "page");
}
```

- [ ] **Step 2: Verify `loadScope` exposes `userId` and `workspace.activeOrgId`**

Run: `sed -n '1,40p' src/lib/scope.ts`
Expected: confirms `Scope` has `userId: string | undefined` and `workspace: Workspace | null` (with `activeOrgId`). If the property names differ, adjust the action code to match.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck` (Expected: PASS)
```bash
git add src/app/favorites-actions.ts
git commit -m "feat(favorites): server actions"
```

---

### Task 4: `FavoriteButton` client island + wire into the catalog card

**Files:**
- Create: `src/app/[locale]/catalog/_components/FavoriteButton.tsx`
- Modify: `src/app/[locale]/catalog/_components/CatalogResults.tsx` (render the heart; accept `favoritedIds` + `lists` props)
- Modify: `src/app/[locale]/catalog/page.tsx` (load the favorited set + the user's lists; pass down)
- Add CSS: `src/app/globals.css` (`.fav-btn` styles)

- [ ] **Step 1: Implement `FavoriteButton.tsx`**

A client component: a heart `<form>` posting `toggleFavorite`, plus a caret that toggles a small menu of the user's lists ("add to list") and a "New list…" inline form. Uses `useTransition` for optimistic heart state.

```tsx
"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  toggleFavorite,
  addFavoriteToList,
  createFavoriteList,
} from "@/app/favorites-actions";

export type FavListOption = { id: string; name: string };

export function FavoriteButton({
  locale,
  titleId,
  initialFavorited,
  lists,
}: {
  locale: string;
  titleId: string;
  initialFavorited: boolean;
  lists: FavListOption[];
}) {
  const t = useTranslations("favorites");
  const [favorited, setFavorited] = useState(initialFavorited);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  function onToggle() {
    setFavorited((v) => !v); // optimistic
    const fd = new FormData();
    fd.set("locale", locale);
    fd.set("titleId", titleId);
    startTransition(async () => {
      await toggleFavorite(fd);
    });
  }

  function onAddToList(listId: string) {
    setFavorited(true);
    const fd = new FormData();
    fd.set("locale", locale);
    fd.set("titleId", titleId);
    fd.set("listId", listId);
    startTransition(async () => {
      await addFavoriteToList(fd);
      setMenuOpen(false);
    });
  }

  function onCreateList(formData: FormData) {
    formData.set("locale", locale);
    formData.set("titleId", titleId);
    setFavorited(true);
    startTransition(async () => {
      await createFavoriteList(formData);
      setMenuOpen(false);
    });
  }

  return (
    <div className="fav-btn" ref={wrapRef}>
      <button
        type="button"
        className={`fav-heart${favorited ? " is-on" : ""}`}
        aria-pressed={favorited}
        aria-label={favorited ? t("remove") : t("add")}
        title={favorited ? t("remove") : t("add")}
        disabled={pending}
        onClick={onToggle}
      >
        {favorited ? "♥" : "♡"}
      </button>
      <button
        type="button"
        className="fav-caret"
        aria-label={t("addToList")}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        ⌄
      </button>
      {menuOpen ? (
        <div className="fav-menu" role="menu">
          <p className="fav-menu-title">{t("addToList")}</p>
          {lists.length > 0 ? (
            <ul>
              {lists.map((l) => (
                <li key={l.id}>
                  <button type="button" role="menuitem" onClick={() => onAddToList(l.id)}>
                    {l.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{t("noLists")}</p>
          )}
          <form action={onCreateList} className="fav-newlist">
            <input
              name="name"
              placeholder={t("newListPlaceholder")}
              aria-label={t("newListPlaceholder")}
              maxLength={80}
              required
            />
            <button type="submit" className="btn ghost small">
              {t("createList")}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add CSS to `src/app/globals.css`**

Append near the `.catalog-card` rules:

```css
.fav-btn { position: absolute; top: 12px; right: 12px; display: flex; gap: 2px; z-index: 2; }
.catalog-card { position: relative; }
.fav-heart, .fav-caret {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm);
  width: 30px; height: 30px; cursor: pointer; line-height: 1; color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center; font-size: 1rem;
}
.fav-heart.is-on { color: #e0245e; border-color: #e0245e; }
.fav-heart:disabled, .fav-caret:disabled { opacity: 0.6; cursor: default; }
.fav-menu {
  position: absolute; top: 36px; right: 0; width: 220px; background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--r-md); padding: 10px; box-shadow: var(--shadow-md, 0 6px 20px rgba(0,0,0,0.12));
}
.fav-menu-title { margin: 0 0 6px; font-weight: 600; font-size: 0.8rem; }
.fav-menu ul { list-style: none; margin: 0 0 8px; padding: 0; max-height: 180px; overflow-y: auto; }
.fav-menu li button { width: 100%; text-align: left; background: none; border: 0; padding: 6px 4px; cursor: pointer; border-radius: var(--r-sm); }
.fav-menu li button:hover { background: var(--surface-2); }
.fav-newlist { display: flex; gap: 4px; }
.fav-newlist input { flex: 1; min-width: 0; }
```

(If `--shadow-md`/`--r-sm` are not defined, substitute the nearest existing token — grep `globals.css` for `--shadow` / `--r-`.)

- [ ] **Step 3: Render the heart in `CatalogResults.tsx`**

Add to the component props:
```tsx
import { FavoriteButton, type FavListOption } from "./FavoriteButton";
// ...
export async function CatalogResults({
  locale,
  titles,
  compareMode,
  favoritedIds,
  favoriteLists,
}: {
  locale: string;
  titles: CatalogTitleRow[];
  compareMode: boolean;
  favoritedIds: Set<string>;
  favoriteLists: FavListOption[];
}) {
```
Inside the `<article className="card catalog-card" key={title.id}>`, immediately after `<TitleSelector id={title.id} />`, add:
```tsx
            <FavoriteButton
              locale={locale}
              titleId={title.id}
              initialFavorited={favoritedIds.has(title.id)}
              lists={favoriteLists}
            />
```

- [ ] **Step 4: Load the favorited set + lists in `catalog/page.tsx` and pass them down**

Find where `<CatalogResults ... />` is rendered and the titles list is built. Add (after the titles query, before render):
```tsx
import { getFavoritedTitleIds } from "@/lib/favorites";
import { loadScope } from "@/lib/scope";
// ...
const scope = await loadScope();
const favoritedIds = scope.userId
  ? await getFavoritedTitleIds(scope.userId, titles.map((t) => t.id))
  : new Set<string>();
const favoriteLists = scope.userId
  ? (await prisma.favoriteList.findMany({
      where: { userId: scope.userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }))
  : [];
```
Then pass `favoritedIds={favoritedIds}` and `favoriteLists={favoriteLists}` to `<CatalogResults />`.
(Confirm `prisma` is already imported in `catalog/page.tsx`; if not, `import { prisma } from "@/lib/prisma";`.)

- [ ] **Step 5: Typecheck + build**

Run: `pnpm typecheck` (Expected: PASS)
Run: `pnpm build` (Expected: PASS — compiles catalog page + client island)

- [ ] **Step 6: Commit**

```bash
git add src/app/[locale]/catalog/_components/FavoriteButton.tsx src/app/[locale]/catalog/_components/CatalogResults.tsx "src/app/[locale]/catalog/page.tsx" src/app/globals.css
git commit -m "feat(favorites): heart + add-to-list on catalog cards"
```

---

### Task 5: Detail page — add the heart, relabel "Save publication"

**Files:**
- Modify: `src/app/[locale]/catalog/[slug]/page.tsx` (add `FavoriteButton` to the identity column; the relabel is i18n-only)
- Modify: `src/messages/en.json` (`catalog.savePublication` text)

- [ ] **Step 1: Load favorite state on the detail page**

Near the top of `TitleDetailPage`, after `title` is loaded and `session` is known, add:
```tsx
import { getFavoritedTitleIds } from "@/lib/favorites";
import { prisma } from "@/lib/prisma"; // already imported — reuse
// ...
const favorited = session?.user?.id
  ? (await getFavoritedTitleIds(session.user.id, [title.id])).has(title.id)
  : false;
const favoriteLists = session?.user?.id
  ? await prisma.favoriteList.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    })
  : [];
```

- [ ] **Step 2: Render the heart in the identity column header**

In the `<div className="detail-head">` left column, change the `<h1>` line to sit beside the heart:
```tsx
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ margin: 0 }}>{title.name}</h1>
            <FavoriteButton
              locale={locale}
              titleId={title.id}
              initialFavorited={favorited}
              lists={favoriteLists}
            />
          </div>
```
Add the import:
```tsx
import { FavoriteButton } from "../_components/FavoriteButton";
```
Add to `.detail-head` (or inline) `position: relative` if needed so the absolute `.fav-btn` anchors correctly — OR override the absolute positioning here by wrapping with a relatively-positioned container; simplest is the flex row above with `.fav-btn { position: static }` when inside `.detail-head`. Add this CSS to `globals.css`:
```css
.detail-head .fav-btn { position: static; }
```

- [ ] **Step 3: Relabel `savePublication`**

In `src/messages/en.json`, change the `catalog.savePublication` value (currently the "Save publication" string) to:
```json
"savePublication": "Add to plan for pricing",
```
Find the matching help/aria string if one exists nearby and align it (grep `savePublication` in en.json).

- [ ] **Step 4: Typecheck + build**

Run: `pnpm typecheck && pnpm build` (Expected: PASS)

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/catalog/[slug]/page.tsx" src/app/globals.css src/messages/en.json
git commit -m "feat(favorites): heart on detail page; relabel save-to-plan action"
```

---

### Task 6: `/favorites` page + nav

**Files:**
- Create: `src/app/[locale]/favorites/page.tsx` (server component)
- Create: `src/app/[locale]/favorites/_components/FavoritesView.tsx` (client component: lists management UI)
- Modify: `src/lib/nav.ts` (add favorites to advertiser + agency audiences)
- Modify: `src/messages/en.json` (`favorites` namespace + `nav.favorites`)

- [ ] **Step 1: Add the `favorites` namespace + nav label to `en.json`**

Add a top-level `"favorites"` namespace:
```json
"favorites": {
  "title": "Favorites",
  "lead": "Publications you've saved. Open one to add a format to a plan.",
  "add": "Add to favorites",
  "remove": "Remove from favorites",
  "addToList": "Add to a list",
  "noLists": "No lists yet.",
  "newListPlaceholder": "New list name",
  "createList": "Create list",
  "allHeading": "All favorites",
  "listsHeading": "Your lists",
  "sharedHeading": "Shared with you",
  "empty": "No favorites yet. Browse the catalog and tap the heart on a publication.",
  "browseCta": "Browse the catalog",
  "itemCount": "{count, plural, =0 {No publications} =1 {1 publication} other {# publications}}",
  "share": "Share with my team",
  "unshare": "Stop sharing",
  "sharedBadge": "Shared",
  "rename": "Rename",
  "delete": "Delete list",
  "open": "Open",
  "removeFromList": "Remove",
  "byOwner": "by {owner}",
  "publishedBy": "{publisher} · {market}"
}
```
And add to the existing `nav` namespace (grep `"nav"` in en.json): `"favorites": "Favorites"`.

- [ ] **Step 2: Add the nav item in `src/lib/nav.ts`**

In the `"advertiser"` case array and the `"agency"` case array, add after the `"lists"` entry:
```ts
        { key: "favorites", label: t("favorites"), href: "/favorites" },
```

- [ ] **Step 3: Implement `FavoritesView.tsx` (client)**

Renders the three sections. Lists use small `<form>`s posting the rename/delete/share/remove actions. Publications reuse a compact card linking to `/catalog/<slug>`.

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  renameFavoriteList,
  deleteFavoriteList,
  setFavoriteListShared,
  removeFavoriteFromList,
  toggleFavorite,
  createFavoriteList,
} from "@/app/favorites-actions";
import type {
  FavoritePublication,
  FavoriteListSummary,
} from "@/lib/favorites";

type ListDetail = {
  id: string;
  name: string;
  sharedWithOrg: boolean;
  isOwner: boolean;
  items: FavoritePublication[];
};

export function FavoritesView({
  locale,
  favorites,
  lists,
  sharedLists,
  openList,
}: {
  locale: string;
  favorites: FavoritePublication[];
  lists: FavoriteListSummary[];
  sharedLists: FavoriteListSummary[];
  openList: ListDetail | null;
}) {
  const t = useTranslations("favorites");

  function PubCard({ pub, listId }: { pub: FavoritePublication; listId?: string }) {
    return (
      <article className="card">
        <h3 style={{ margin: 0 }}>
          <Link className="card-link" href={`/catalog/${pub.slug}`}>
            {pub.titleName}
          </Link>
        </h3>
        <div className="muted">
          {t("publishedBy", { publisher: pub.publisherName, market: pub.marketCode })}
        </div>
        <div className="cluster" style={{ marginTop: 8, gap: 6 }}>
          {listId ? (
            <form action={removeFavoriteFromList}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="listId" value={listId} />
              <input type="hidden" name="favoriteId" value={pub.favoriteId} />
              <button type="submit" className="btn ghost small">{t("removeFromList")}</button>
            </form>
          ) : (
            <form action={toggleFavorite}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="titleId" value={pub.titleId} />
              <button type="submit" className="btn ghost small">{t("remove")}</button>
            </form>
          )}
        </div>
      </article>
    );
  }

  // List-detail view (one open list)
  if (openList) {
    return (
      <section>
        <p><Link href="/favorites">← {t("title")}</Link></p>
        <h1>{openList.name}{openList.sharedWithOrg ? ` · ${t("sharedBadge")}` : ""}</h1>
        {openList.items.length === 0 ? (
          <p className="muted">{t("itemCount", { count: 0 })}</p>
        ) : (
          <div className="grid">
            {openList.items.map((pub) => (
              <PubCard key={pub.favoriteId} pub={pub} listId={openList.isOwner ? openList.id : undefined} />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 28 }}>
      <div>
        <h2>{t("allHeading")}</h2>
        {favorites.length === 0 ? (
          <div className="empty-state">
            <p className="muted">{t("empty")}</p>
            <Link href="/catalog" className="btn">{t("browseCta")}</Link>
          </div>
        ) : (
          <div className="grid">
            {favorites.map((pub) => <PubCard key={pub.favoriteId} pub={pub} />)}
          </div>
        )}
      </div>

      <div>
        <h2>{t("listsHeading")}</h2>
        <form action={createFavoriteList} className="cluster" style={{ gap: 6, marginBottom: 12 }}>
          <input type="hidden" name="locale" value={locale} />
          <input name="name" placeholder={t("newListPlaceholder")} aria-label={t("newListPlaceholder")} maxLength={80} required />
          <button type="submit" className="btn ghost small">{t("createList")}</button>
        </form>
        {lists.length === 0 ? (
          <p className="muted">{t("noLists")}</p>
        ) : (
          <ul className="list-rows">
            {lists.map((l) => (
              <li key={l.id} className="card" style={{ display: "grid", gap: 8 }}>
                <div className="cluster" style={{ justifyContent: "space-between" }}>
                  <Link href={`/favorites?list=${l.id}`}>
                    <strong>{l.name}</strong> · {t("itemCount", { count: l.itemCount })}
                    {l.sharedWithOrg ? ` · ${t("sharedBadge")}` : ""}
                  </Link>
                </div>
                <div className="cluster" style={{ gap: 6, flexWrap: "wrap" }}>
                  <form action={setFavoriteListShared}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="listId" value={l.id} />
                    <input type="hidden" name="shared" value={l.sharedWithOrg ? "0" : "1"} />
                    <button type="submit" className="btn ghost small">
                      {l.sharedWithOrg ? t("unshare") : t("share")}
                    </button>
                  </form>
                  <RenameForm locale={locale} listId={l.id} current={l.name} label={t("rename")} />
                  <form action={deleteFavoriteList}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="listId" value={l.id} />
                    <button type="submit" className="btn ghost small">{t("delete")}</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sharedLists.length > 0 ? (
        <div>
          <h2>{t("sharedHeading")}</h2>
          <ul className="list-rows">
            {sharedLists.map((l) => (
              <li key={l.id} className="card">
                <Link href={`/favorites?list=${l.id}`}>
                  <strong>{l.name}</strong> · {t("itemCount", { count: l.itemCount })}
                  {l.ownerName ? ` · ${t("byOwner", { owner: l.ownerName })}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );

  function RenameForm({ locale, listId, current, label }: { locale: string; listId: string; current: string; label: string }) {
    const [editing, setEditing] = useState(false);
    if (!editing) {
      return <button type="button" className="btn ghost small" onClick={() => setEditing(true)}>{label}</button>;
    }
    return (
      <form action={renameFavoriteList} className="cluster" style={{ gap: 4 }}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="listId" value={listId} />
        <input name="name" defaultValue={current} maxLength={80} required />
        <button type="submit" className="btn ghost small">{label}</button>
      </form>
    );
  }
}
```

- [ ] **Step 4: Implement the server page `favorites/page.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loadScope } from "@/lib/scope";
import { getFavoritesOverview, getFavoriteListDetail } from "@/lib/favorites";
import { FavoritesView } from "./_components/FavoritesView";

export const dynamic = "force-dynamic";

export default async function FavoritesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "favorites" });

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/signin?next=/${locale}/favorites`);
  const scope = await loadScope();
  const orgId = scope.workspace?.activeOrgId ?? null;

  const listParam = typeof sp.list === "string" ? sp.list : undefined;
  const openList = listParam
    ? await getFavoriteListDetail(scope.userId!, orgId, listParam)
    : null;

  const overview = await getFavoritesOverview(scope.userId!, orgId);

  return (
    <>
      <header className="page-header">
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>
      <FavoritesView
        locale={locale}
        favorites={overview.favorites}
        lists={overview.lists}
        sharedLists={overview.sharedLists}
        openList={openList}
      />
    </>
  );
}
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm typecheck && pnpm build` (Expected: PASS — confirms the new route, client component, and nav compile)

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/favorites" src/lib/nav.ts src/messages/en.json
git commit -m "feat(favorites): /favorites page + nav entry"
```

---

### Task 7: E2E test (Playwright)

**Files:**
- Test: locate the existing E2E spec dir (the saved-list E2E from PR "feat/saved-lists-followups"). Run `git log --oneline --all | head` and `grep -rl "test(" --include="*.spec.ts" --include="*.e2e.ts" .` to find it; place the new spec beside it. If none exists, create `e2e/favorites.spec.ts` and follow the saved-list E2E's auth/setup helpers.

- [ ] **Step 1: Write the E2E spec**

```ts
// Mirror the existing saved-list E2E for sign-in + base URL helpers.
import { test, expect } from "@playwright/test";
import { signInAsBuyer } from "./helpers"; // reuse whatever the saved-list E2E uses

test("heart a publication from a card, see it under All favorites", async ({ page }) => {
  await signInAsBuyer(page);
  await page.goto("/en/catalog");
  const firstCard = page.locator("article.catalog-card").first();
  await firstCard.getByRole("button", { name: /add to favorites/i }).click();
  await page.goto("/en/favorites");
  await expect(page.getByRole("heading", { name: /all favorites/i })).toBeVisible();
  await expect(page.locator("article.card").first()).toBeVisible();
});

test("create a favorites list and share it", async ({ page }) => {
  await signInAsBuyer(page);
  await page.goto("/en/favorites");
  await page.getByPlaceholder(/new list name/i).fill("E2E picks");
  await page.getByRole("button", { name: /^create list$/i }).click();
  await expect(page.getByText("E2E picks")).toBeVisible();
  await page.getByRole("button", { name: /share with my team/i }).first().click();
  await expect(page.getByText(/shared/i).first()).toBeVisible();
});
```

- [ ] **Step 2: Run the E2E (against a running dev server / the project's E2E runner)**

Run: the repo's E2E command (check `package.json` / the saved-list E2E docs — e.g. `pnpm playwright test favorites`).
Expected: PASS. If the E2E harness needs a seeded buyer + DB, follow the saved-list E2E's setup; if that infra is unavailable locally, ensure the spec is wired into CI alongside the existing E2E.

- [ ] **Step 3: Commit**

```bash
git add e2e
git commit -m "test(favorites): E2E heart-from-card + create/share list"
```

---

### Task 8: Translations + final verification

**Files:**
- Modify: `src/messages/no.json`, `da.json`, `sv.json`, `fi.json`, `de.json` (translate the new `favorites` namespace + `nav.favorites` + the relabeled `catalog.savePublication`)

- [ ] **Step 1: Translate the new strings into each locale**

For each of `no/da/sv/fi/de`, add the `favorites` namespace mirroring the English keys with natural native copy (avoid literal calques — see translation-quality memory), add `nav.favorites`, and update `catalog.savePublication` to the local equivalent of "Add to plan for pricing". Keep the ICU plural syntax in `itemCount` intact per locale.

- [ ] **Step 2: Verify message-key parity across locales**

Run: `node -e "const en=require('./src/messages/en.json');for(const l of ['no','da','sv','fi','de']){const m=require('./src/messages/'+l+'.json');const miss=Object.keys(en.favorites).filter(k=>!m.favorites||!(k in m.favorites));if(miss.length)console.log(l,'missing favorites:',miss);if(!m.nav||!('favorites'in m.nav))console.log(l,'missing nav.favorites');}console.log('parity check done')"`
Expected: only `parity check done` (no missing-key lines).

- [ ] **Step 3: Full verification**

Run: `pnpm typecheck` (Expected: PASS)
Run: `pnpm build` (Expected: PASS)
Run: `pnpm test` (Expected: PASS — unit tests unaffected)
Run: `pnpm test:it` (Expected: PASS — favorites IT tests green; requires local DB, else verify in CI)

- [ ] **Step 4: Commit**

```bash
git add src/messages
git commit -m "i18n(favorites): translate favorites namespace into no/da/sv/fi/de"
```

---

## Self-review (completed during planning)

- **Spec coverage:** publications-only (Tasks 1–2 model titles only) ✓; personal + per-list sharing (Task 2 `sharedWithOrg`, ownership guard; Task 6 share toggle) ✓; heart + list-pick on cards (Task 4) and detail page (Task 5) ✓; discovery-only, no plan bridge (no such code) ✓; "Save publication" relabel (Task 5) ✓; new tables separate from SavedList (Task 1) ✓; `/favorites` with All / Your lists / Shared (Task 6) ✓; nav entry (Task 6) ✓; filled-heart query (Task 4/5 `getFavoritedTitleIds`) ✓; tests (Tasks 2, 7) ✓; i18n (Tasks 6, 8) ✓.
- **Type consistency:** `FavoritePublication` / `FavoriteListSummary` defined in `favorites.ts` (Task 2) and consumed in `FavoritesView` (Task 6); `FavListOption` defined in `FavoriteButton` (Task 4) and used by `CatalogResults` (Task 4) + detail page (Task 5). Action names match between `favorites-actions.ts` (Task 3) and all callers.
- **Open verification risk:** IT + E2E runs depend on a local DB / E2E harness that may be unavailable in this environment (per repo memory the local atnative DB was dropped; DB access is prod-MCP-only). Where local runs aren't possible, the gate is `pnpm typecheck && pnpm build` locally plus CI for `test:it`/E2E. Flag to the user before relying on a green IT/E2E locally.
