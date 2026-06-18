import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { clampQuantity, MAX_QTY } from "@/lib/basket";
import type { AuthorshipMode } from "@/lib/authorship";

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
    // createdAt tiebreaker keeps ordering deterministic even when two
    // concurrent adds land on the same sortOrder (read-max-then-+1 has no lock).
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      product: {
        include: {
          title: { include: { publisher: true, market: true } },
          priceRules: true,
        },
      },
      title: { include: { publisher: true } },
    },
  },
};

async function loadList(id: string) {
  return prisma.savedList.findUnique({ where: { id }, include: ITEM_INCLUDE });
}

export type ActiveList = NonNullable<Awaited<ReturnType<typeof loadList>>>;

/**
 * Resolve the id of the active SavedList for `orgId` WITHOUT loading its items.
 * If `activeId` points at a list still owned by this org and not archived, reuse
 * it. Otherwise adopt the org's most-recent non-archived list, and only create a
 * fresh one if the org has none. The adopt-or-create runs under a per-org
 * advisory lock so two racing first-adds converge on ONE list instead of each
 * creating its own and orphaning the loser (and the item just added to it).
 * The caller persists the returned id into the cookie.
 */
export async function ensureActiveListId(orgId: string, activeId: string | null, createdById?: string): Promise<string> {
  if (activeId) {
    const existing = await prisma.savedList.findUnique({
      where: { id: activeId },
      select: { id: true, organizationId: true, archivedAt: true },
    });
    if (existing && existing.organizationId === orgId && !existing.archivedAt) return existing.id;
  }
  return prisma.$transaction(async (tx) => {
    // Serialize active-list creation per org so concurrent first-adds don't
    // each create a fresh list. hashtext(orgId)::bigint is the lock key.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`;
    const adopted = await tx.savedList.findFirst({
      where: { organizationId: orgId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (adopted) return adopted.id;
    const created = await tx.savedList.create({
      data: { organizationId: orgId, createdById: createdById ?? null },
      select: { id: true },
    });
    return created.id;
  });
}

/** As `ensureActiveListId` but returns the full list (with items) for render/submit. */
export async function ensureActiveList(orgId: string, activeId: string | null, createdById?: string) {
  const id = await ensureActiveListId(orgId, activeId, createdById);
  return (await loadList(id))!;
}

/** Resolve the active list for RENDER without creating one: the cookie's list
 *  if still owned + unarchived, else the org's most-recently-updated non-archived
 *  list, else null. Server Components can't persist a cookie, so they must never
 *  lazily create — that's the action path's job (ensureActiveList). */
export async function resolveActiveList(orgId: string, activeId: string | null) {
  if (activeId) {
    const existing = await loadList(activeId);
    if (existing && existing.organizationId === orgId && !existing.archivedAt) return existing;
  }
  const recent = await prisma.savedList.findFirst({
    where: { organizationId: orgId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return recent ? loadList(recent.id) : null;
}

/** One-time fold of a legacy cookie basket into a fresh SavedList. Returns null if empty/all-invalid. */
export async function migrateLegacyBasket(
  orgId: string,
  basket: Array<{ productId: string; quantity: number; withContent?: boolean }>,
  createdById: string | null,
) {
  if (basket.length === 0) return null;
  const valid = await prisma.product.findMany({
    where: { id: { in: basket.map((b) => b.productId) }, active: true, bookable: true },
    select: { id: true },
  });
  const validIds = new Set(valid.map((p) => p.id));
  const rows = basket.filter((b) => validIds.has(b.productId));
  if (rows.length === 0) return null;
  return prisma.savedList.create({
    data: {
      organizationId: orgId,
      name: "Imported list",
      createdById,
      items: {
        create: rows.map((b, idx) => ({
          productId: b.productId,
          titleId: null,
          quantity: clampQuantity(b.quantity),
          withContent: !!b.withContent,
          sortOrder: idx,
        })),
      },
    },
  });
}

async function nextSortOrder(listId: string): Promise<number> {
  const last = await prisma.savedListItem.findFirst({
    where: { listId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? -1) + 1;
}

/**
 * Append a product line, or bump quantity if that product is already on the list.
 * Atomic upsert on the (listId, productId) unique — two concurrent adds (double
 * click / two tabs) can no longer create duplicate rows; the second is a bump.
 */
export async function addProductItem(listId: string, productId: string, withContent = false) {
  assertItemShape({ productId, titleId: null });
  const item = await prisma.savedListItem.upsert({
    where: { listId_productId: { listId, productId } },
    create: { listId, productId, titleId: null, withContent, sortOrder: await nextSortOrder(listId) },
    update: { quantity: { increment: 1 } },
  });
  // upsert's increment can't express min(); cap to MAX_QTY in a follow-up.
  if (item.quantity > MAX_QTY) {
    return prisma.savedListItem.update({ where: { id: item.id }, data: { quantity: MAX_QTY } });
  }
  return item;
}

/** Append a title placeholder. Idempotent via the (listId, titleId) unique upsert. */
export async function addTitleItem(listId: string, titleId: string) {
  assertItemShape({ productId: null, titleId });
  return prisma.savedListItem.upsert({
    where: { listId_titleId: { listId, titleId } },
    create: { listId, titleId, productId: null, sortOrder: await nextSortOrder(listId) },
    update: {}, // already present — no-op (do not duplicate or bump a placeholder)
  });
}

/**
 * Convert a title placeholder into a concrete product line. If that product is
 * ALREADY a line on the same list, the (listId, productId) unique would reject a
 * second row — so merge instead: bump the existing product line's quantity by the
 * placeholder's and drop the placeholder. Returns the resulting product line.
 */
export async function resolveTitleItem(itemId: string, productId: string) {
  const item = await prisma.savedListItem.findUnique({
    where: { id: itemId },
    select: { listId: true, quantity: true },
  });
  if (!item) return null;
  const existingProduct = await prisma.savedListItem.findUnique({
    where: { listId_productId: { listId: item.listId, productId } },
    select: { id: true, quantity: true },
  });
  if (existingProduct && existingProduct.id !== itemId) {
    const [merged] = await prisma.$transaction([
      prisma.savedListItem.update({
        where: { id: existingProduct.id },
        data: { quantity: clampQuantity(existingProduct.quantity + item.quantity) },
      }),
      prisma.savedListItem.delete({ where: { id: itemId } }),
    ]);
    return merged;
  }
  return prisma.savedListItem.update({
    where: { id: itemId },
    data: { productId, titleId: null },
  });
}

/** Idempotent: deleteMany affects 0 rows (no P2025) if a concurrent action already removed it. */
export async function removeItem(itemId: string) {
  return prisma.savedListItem.deleteMany({ where: { id: itemId } });
}

/** Idempotent: updateMany no-ops (no P2025) if the row was concurrently removed. */
export async function setItemQuantity(itemId: string, quantity: number) {
  return prisma.savedListItem.updateMany({ where: { id: itemId }, data: { quantity: clampQuantity(quantity) } });
}

export type PlanItemSnapshot = {
  productId: string | null;
  titleId: string | null;
  quantity: number;
  withContent: boolean;
  authorshipMode: AuthorshipMode;
  notes: string | null;
};

/** Project SavedListItems into PlanItem rows, preserving product/title shape. */
export function snapshotListToPlanData(
  items: Array<{
    productId: string | null;
    titleId: string | null;
    quantity: number;
    withContent: boolean;
    authorshipMode: PlanItemSnapshot["authorshipMode"];
    notes: string | null;
  }>,
): PlanItemSnapshot[] {
  return items.map((i) => ({
    productId: i.productId,
    titleId: i.titleId,
    quantity: i.quantity,
    withContent: i.withContent,
    authorshipMode: i.authorshipMode,
    notes: i.notes,
  }));
}
