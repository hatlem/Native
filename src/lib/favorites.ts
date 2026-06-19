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
  // The owner's home org this list shares within; null = not shareable yet.
  organizationId: string | null;
};

export type FavoritesOverview = {
  favorites: FavoritePublication[];
  lists: FavoriteListSummary[];
  sharedLists: FavoriteListSummary[];
};

export type FavoriteListDetail = {
  id: string;
  name: string;
  sharedWithOrg: boolean;
  isOwner: boolean;
  ownerName: string | null;
  items: FavoritePublication[];
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

/** Remove a title from one of the user's lists, addressed by titleId (the card
 *  knows the title, not the favorite row). Keeps the heart. No-op if the title
 *  isn't favorited. Verifies list ownership. */
export async function removeFavoriteFromListByTitle(
  userId: string,
  titleId: string,
  listId: string,
): Promise<void> {
  await requireOwnList(userId, listId);
  const fav = await prisma.favorite.findUnique({
    where: { userId_titleId: { userId, titleId } },
    select: { id: true },
  });
  if (!fav) return;
  await prisma.favoriteListItem.deleteMany({ where: { listId, favoriteId: fav.id } });
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
  if (shared) {
    // Can't share a list with no home org to share within (no-org owner). No-op
    // rather than a "Shared" badge that nobody can actually see.
    const list = await prisma.favoriteList.findUnique({
      where: { id: listId },
      select: { organizationId: true },
    });
    if (!list?.organizationId) return;
  }
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
    // Callers pass active titles today; the title.active guard is cheap
    // insurance against a future caller surfacing hearts for 404-ing titles.
    where: { userId, titleId: { in: titleIds }, title: { active: true } },
    select: { titleId: true },
  });
  return new Set(rows.map((r) => r.titleId));
}

/** For each of the given titles, which of the user's lists already contain it —
 *  drives the checked state of the card's "add to list" checklist so a buyer can
 *  see (and toggle) membership across several lists at once. Returns a plain
 *  object (titleId → listId[]) so it serializes across the server/client boundary. */
export async function getListMembershipForTitles(
  userId: string,
  titleIds: string[],
): Promise<Record<string, string[]>> {
  if (titleIds.length === 0) return {};
  const rows = await prisma.favoriteListItem.findMany({
    where: {
      list: { userId },
      favorite: { userId, titleId: { in: titleIds }, title: { active: true } },
    },
    select: { listId: true, favorite: { select: { titleId: true } } },
  });
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    (map[r.favorite.titleId] ??= []).push(r.listId);
  }
  return map;
}

function toListSummary(l: {
  id: string;
  name: string;
  sharedWithOrg: boolean;
  organizationId: string | null;
  _count: { items: number };
  user?: { name: string | null; email: string } | null;
}): FavoriteListSummary {
  return {
    id: l.id,
    name: l.name,
    sharedWithOrg: l.sharedWithOrg,
    itemCount: l._count.items,
    ownerName: l.user ? (l.user.name ?? l.user.email) : null,
    organizationId: l.organizationId,
  };
}

function toPublication(f: {
  id: string;
  titleId: string;
  title: {
    name: string;
    slug: string;
    market: { code: string };
    publisher: { name: string };
  };
}): FavoritePublication {
  return {
    favoriteId: f.id,
    titleId: f.titleId,
    titleName: f.title.name,
    slug: f.title.slug,
    publisherName: f.title.publisher.name,
    marketCode: f.title.market.code,
  };
}

const PUBLICATION_SELECT = {
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
} as const;

// A title deactivated AFTER being favorited would still sit in the pool and
// link to a /catalog/[slug] that 404s (the detail page hides inactive titles).
// Hide those favorites and exclude them from list counts, so what the buyer
// sees — and the counts beside each list — stay consistent with the catalog.
const ACTIVE_LIST_ITEM = { favorite: { title: { active: true } } } as const;
const ACTIVE_ITEM_COUNT = {
  select: { items: { where: ACTIVE_LIST_ITEM } },
} as const;

/** Everything the /favorites page needs: the flat pool, the user's own lists,
 *  and same-org lists teammates have shared. */
export async function getFavoritesOverview(
  userId: string,
  organizationId: string | null,
): Promise<FavoritesOverview> {
  const [favRows, ownLists, sharedRows] = await Promise.all([
    prisma.favorite.findMany({
      where: { userId, title: { active: true } },
      orderBy: { createdAt: "desc" },
      select: PUBLICATION_SELECT,
    }),
    prisma.favoriteList.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, sharedWithOrg: true, organizationId: true, _count: ACTIVE_ITEM_COUNT },
    }),
    organizationId
      ? prisma.favoriteList.findMany({
          where: { organizationId, sharedWithOrg: true, userId: { not: userId } },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            name: true,
            sharedWithOrg: true,
            organizationId: true,
            _count: ACTIVE_ITEM_COUNT,
            user: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    favorites: favRows.map(toPublication),
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
): Promise<FavoriteListDetail | null> {
  const list = await prisma.favoriteList.findUnique({
    where: { id: listId },
    select: {
      id: true,
      name: true,
      sharedWithOrg: true,
      userId: true,
      organizationId: true,
      user: { select: { name: true, email: true } },
      items: {
        where: ACTIVE_LIST_ITEM,
        orderBy: { sortOrder: "asc" },
        select: { favorite: { select: PUBLICATION_SELECT } },
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
    ownerName: list.user ? (list.user.name ?? list.user.email) : null,
    items: list.items.map((i) => toPublication(i.favorite)),
  };
}
