import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { clampQuantity } from "@/lib/basket";

export const ACTIVE_LIST_COOKIE = "nativespin_active_list";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export type ItemShape = { productId: string | null; titleId: string | null };

/** A SavedListItem must reference exactly one of product or title. */
export function assertItemShape(item: ItemShape): void {
  const hasProduct = !!item.productId;
  const hasTitle = !!item.titleId;
  if (hasProduct === hasTitle) {
    throw new Error("SavedListItem must reference exactly one of productId / titleId");
  }
}

/** Any unresolved Title placeholder forces the desk RFQ path (cannot auto-price). */
export function listForcesRfq(items: ItemShape[]): boolean {
  return items.some((i) => !i.productId);
}

export async function readActiveListId(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_LIST_COOKIE)?.value ?? null;
}

export async function writeActiveListId(id: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_LIST_COOKIE, id, COOKIE_OPTS);
}

export async function clearActiveListId(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_LIST_COOKIE);
}

const ITEM_INCLUDE = {
  items: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      product: { include: { title: { include: { publisher: true } }, priceRules: true } },
      title: { include: { publisher: true } },
    },
  },
};

async function loadList(id: string) {
  return prisma.savedList.findUnique({ where: { id }, include: ITEM_INCLUDE });
}

export type ActiveList = NonNullable<Awaited<ReturnType<typeof loadList>>>;

/**
 * Resolve the active SavedList for `orgId`. If `activeId` points at a list that
 * still belongs to this org and isn't archived, reuse it; otherwise create a
 * fresh "Untitled list". The caller persists the returned id into the cookie.
 */
export async function ensureActiveList(orgId: string, activeId: string | null, createdById?: string) {
  if (activeId) {
    const existing = await loadList(activeId);
    if (existing && existing.organizationId === orgId && !existing.archivedAt) return existing;
  }
  const created = await prisma.savedList.create({
    data: { organizationId: orgId, createdById: createdById ?? null },
  });
  return (await loadList(created.id))!;
}

async function nextSortOrder(listId: string): Promise<number> {
  const last = await prisma.savedListItem.findFirst({
    where: { listId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? -1) + 1;
}

/** Append a product line, or bump quantity if that product is already on the list. */
export async function addProductItem(listId: string, productId: string, withContent = false) {
  const existing = await prisma.savedListItem.findFirst({ where: { listId, productId } });
  if (existing) {
    return prisma.savedListItem.update({
      where: { id: existing.id },
      data: { quantity: clampQuantity(existing.quantity + 1) },
    });
  }
  return prisma.savedListItem.create({
    data: { listId, productId, titleId: null, withContent, sortOrder: await nextSortOrder(listId) },
  });
}

/** Append a title placeholder (idempotent: no duplicate title line). */
export async function addTitleItem(listId: string, titleId: string) {
  const existing = await prisma.savedListItem.findFirst({ where: { listId, titleId } });
  if (existing) return existing;
  return prisma.savedListItem.create({
    data: { listId, titleId, productId: null, sortOrder: await nextSortOrder(listId) },
  });
}

/** Convert a title placeholder into a concrete product line. */
export async function resolveTitleItem(itemId: string, productId: string) {
  return prisma.savedListItem.update({
    where: { id: itemId },
    data: { productId, titleId: null },
  });
}

export async function removeItem(itemId: string) {
  return prisma.savedListItem.delete({ where: { id: itemId } });
}

export async function setItemQuantity(itemId: string, quantity: number) {
  return prisma.savedListItem.update({ where: { id: itemId }, data: { quantity: clampQuantity(quantity) } });
}
