"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { recordAudit } from "@/lib/audit";
import { readBasket } from "@/lib/basket";
import {
  ensureActiveListId,
  addProductItem,
  addTitleItem,
  resolveTitleItem,
  removeItem,
  setItemQuantity,
  readActiveListId,
  writeActiveListId,
  clearActiveListId,
  migrateLegacyBasket,
} from "@/lib/lists";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requireActiveOrg(locale: string) {
  const scope = await loadScope();
  const orgId = scope.workspace?.activeOrgId;
  if (!scope.userId) redirect(`/${locale}/signin`);
  if (!orgId) redirect(`/${locale}/plan?error=client`); // agency must pick a client first
  return { scope, orgId };
}

/** Resolve (adopt-or-create) the active list id for the active org and persist
 *  it. Returns only the id — the add paths don't need the deep list tree.
 *  ensureActiveListId adopts the org's most-recent list under a per-org advisory
 *  lock, so a first-add race converges on one list rather than orphaning one. */
async function activeList(locale: string) {
  const { scope, orgId } = await requireActiveOrg(locale);
  let activeId = await readActiveListId();
  if (!activeId) {
    const legacy = await readBasket(); // legacy cookie, may be []
    const migrated = legacy.length ? await migrateLegacyBasket(orgId, legacy, scope.userId ?? null) : null;
    if (migrated) {
      activeId = migrated.id;
      (await cookies()).delete("nativespin_plan");
    }
  }
  const listId = await ensureActiveListId(orgId, activeId, scope.userId);
  await writeActiveListId(listId);
  return { scope, orgId, listId };
}

export async function addProductToList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const productId = str(formData, "productId");
  if (productId) {
    const valid = await prisma.product.findFirst({
      where: { id: productId, active: true, bookable: true },
      select: { id: true },
    });
    if (valid) {
      const { listId } = await activeList(locale);
      await addProductItem(listId, productId, str(formData, "withContent") === "1");
    }
  }
  redirect(`/${locale}/plan`);
}

export async function addRecommendedToList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const ids = str(formData, "productIds").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length) {
    const valid = await prisma.product.findMany({
      where: { id: { in: ids }, active: true, bookable: true },
      select: { id: true },
    });
    const validIds = new Set(valid.map((p) => p.id));
    const { listId } = await activeList(locale);
    // distinct product ids → each upserts its own (listId,productId) row, so the
    // adds are independent and safe to run concurrently (no serial round-trips).
    await Promise.all(ids.filter((id) => validIds.has(id)).map((id) => addProductItem(listId, id)));
  }
  redirect(`/${locale}/plan`);
}

export async function saveTitleToList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const titleId = str(formData, "titleId");
  if (titleId) {
    const valid = await prisma.title.findFirst({ where: { id: titleId, active: true }, select: { id: true } });
    if (valid) {
      const { listId } = await activeList(locale);
      await addTitleItem(listId, titleId);
    }
  }
  redirect(`/${locale}/plan`);
}

/** Shared guard: the item's list must be in the caller's scope. Returns the
 *  item (incl. its productId/titleId) so callers needn't re-query. */
async function ownItem(locale: string, itemId: string) {
  const scope = await loadScope();
  const item = await prisma.savedListItem.findUnique({
    where: { id: itemId },
    select: { id: true, productId: true, titleId: true, list: { select: { organizationId: true } } },
  });
  if (!item || !canActOnOrg(scope, item.list.organizationId)) redirect(`/${locale}/plan`);
  return item;
}

export async function removeListItem(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  await ownItem(locale, itemId);
  await removeItem(itemId);
  revalidatePath(`/${locale}/plan`);
}

export async function setListItemQuantity(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  await ownItem(locale, itemId);
  await setItemQuantity(itemId, Number(str(formData, "quantity")));
  revalidatePath(`/${locale}/plan`);
}

export async function setListItemContent(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  await ownItem(locale, itemId);
  // updateMany no-ops (no P2025) if the row was concurrently removed.
  await prisma.savedListItem.updateMany({
    where: { id: itemId },
    data: { withContent: str(formData, "withContent") === "1" },
  });
  redirect(`/${locale}/plan`);
}

export async function resolveTitleLine(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  const productId = str(formData, "productId");
  const item = await ownItem(locale, itemId);
  // Only a title placeholder is resolvable, and ONLY to a product OF THAT TITLE —
  // a tampered/replayed POST can't swap in a different publisher's product.
  if (!item.titleId) redirect(`/${locale}/plan`);
  const product = await prisma.product.findFirst({
    where: { id: productId, titleId: item.titleId, active: true, bookable: true },
    select: { id: true },
  });
  if (product) await resolveTitleItem(itemId, productId);
  redirect(`/${locale}/plan`);
}

export async function createList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const { scope, orgId } = await requireActiveOrg(locale);
  const list = await prisma.savedList.create({
    data: { organizationId: orgId, name: str(formData, "name") || "Untitled list", createdById: scope.userId ?? null },
  });
  await writeActiveListId(list.id);
  await recordAudit(scope.userId ?? null, "list.create", `SavedList:${list.id}`, { orgId });
  redirect(`/${locale}/plan`);
}

export async function selectActiveList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const scope = await loadScope();
  const list = await prisma.savedList.findUnique({ where: { id: listId }, select: { organizationId: true } });
  if (list && canActOnOrg(scope, list.organizationId)) await writeActiveListId(listId);
  redirect(`/${locale}/plan`);
}

export async function renameList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const scope = await loadScope();
  const list = await prisma.savedList.findUnique({ where: { id: listId }, select: { organizationId: true } });
  if (list && canActOnOrg(scope, list.organizationId)) {
    await prisma.savedList.update({ where: { id: listId }, data: { name: str(formData, "name") || "Untitled list" } });
  }
  revalidatePath(`/${locale}/plan`);
  revalidatePath(`/${locale}/lists`);
}

export async function archiveList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const scope = await loadScope();
  const list = await prisma.savedList.findUnique({ where: { id: listId }, select: { organizationId: true } });
  if (list && canActOnOrg(scope, list.organizationId)) {
    await prisma.savedList.update({ where: { id: listId }, data: { archivedAt: new Date() } });
    await recordAudit(scope.userId ?? null, "list.archive", `SavedList:${listId}`, {});
    if ((await readActiveListId()) === listId) await clearActiveListId();
  }
  redirect(`/${locale}/lists`);
}

export async function duplicateList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const scope = await loadScope();
  const source = await prisma.savedList.findUnique({ where: { id: listId }, include: { items: true } });
  if (!source || !canActOnOrg(scope, source.organizationId)) redirect(`/${locale}/lists`);
  const copy = await prisma.savedList.create({
    data: {
      organizationId: source.organizationId,
      name: `${source.name} (copy)`,
      note: source.note,
      createdById: scope.userId ?? null,
      items: {
        create: source.items.map((i) => ({
          productId: i.productId,
          titleId: i.titleId,
          quantity: i.quantity,
          withContent: i.withContent,
          authorshipMode: i.authorshipMode,
          notes: i.notes,
          sortOrder: i.sortOrder,
        })),
      },
    },
  });
  await writeActiveListId(copy.id);
  await recordAudit(scope.userId ?? null, "list.duplicate", `SavedList:${copy.id}`, { sourceId: listId });
  redirect(`/${locale}/plan`);
}
