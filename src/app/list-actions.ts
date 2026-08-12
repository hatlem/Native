"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { recordAudit } from "@/lib/audit";
import { readBasket } from "@/lib/basket";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";
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
  if (!orgId) {
    // Agency with no client selected hit a list action — the no-client funnel.
    console.warn("checkout.blocked", { reason: "client", userId: scope.userId });
    redirect(`/${locale}/plan?error=client`);
  }
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

// A same-origin relative path (starts with a single "/") the caller wants to
// return to after the add, e.g. the campaign flow's Discover step. Falls back
// to the given default. The single-slash check blocks "//host" open redirects.
function safeReturnTo(formData: FormData, locale: string, fallback: string): string {
  const raw = str(formData, "returnTo");
  if (raw.startsWith("/") && !raw.startsWith("//")) return `/${locale}${raw}`;
  return `/${locale}${fallback}`;
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
  redirect(safeReturnTo(formData, locale, "/plan"));
}

export type ShortlistAddResult =
  | { ok: true; listId: string }
  | { ok: false; reason: "signin" | "no-client" | "invalid-product" };

// Client-invoked counterpart to addProductToList: same validation and
// upsert, but returns a result instead of redirecting. The catalog's
// optimistic "Add to plan" button calls this directly (not via a <form
// action>) and must stay on /catalog — reverting its own optimistic state
// on {ok:false} rather than following a server redirect. Deliberately not
// sharing activeList()/requireActiveOrg() above: those redirect on
// failure, which is exactly the behavior this needs to not have, and
// duplicating a few lines here is safer than changing a helper several
// other (redirecting) actions in this file depend on.
export async function addProductToActiveList(
  productId: string,
  withContent: boolean,
  locale: string,
): Promise<ShortlistAddResult> {
  const scope = await loadScope();
  if (!scope.userId) return { ok: false, reason: "signin" };
  const orgId = scope.workspace?.activeOrgId;
  if (!orgId) return { ok: false, reason: "no-client" };

  const valid = await prisma.product.findFirst({
    where: { id: productId, active: true, bookable: true },
    select: { id: true },
  });
  if (!valid) return { ok: false, reason: "invalid-product" };

  let activeId = await readActiveListId();
  if (!activeId) {
    const legacy = await readBasket();
    const migrated = legacy.length
      ? await migrateLegacyBasket(orgId, legacy, scope.userId)
      : null;
    if (migrated) {
      activeId = migrated.id;
      (await cookies()).delete("nativespin_plan");
    }
  }
  const listId = await ensureActiveListId(orgId, activeId, scope.userId);
  await writeActiveListId(listId);
  await addProductItem(listId, productId, withContent);
  revalidatePath(`/${locale}/plan`);
  revalidatePath(`/${locale}/requests`);
  return { ok: true, listId };
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

// Bulk-adopt every hearted title (the personal favorites pool) into the active
// list in one go — the hearts↔lists bridge surfaced on /plan. Same idempotent
// upsert as every other add path, so re-running it (e.g. after hearting more
// titles) never duplicates a line.
export async function addAllFavoritesToList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const { scope, listId } = await activeList(locale);
  const favs = await prisma.favorite.findMany({
    where: { userId: scope.userId!, title: catalogVisibleTitleWhere },
    select: { titleId: true },
  });
  await Promise.all(favs.map((f) => addTitleItem(listId, f.titleId)));
  redirect(`/${locale}/plan`);
}

export async function saveTitleToList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const titleId = str(formData, "titleId");
  if (titleId) {
    const valid = await prisma.title.findFirst({ where: { id: titleId, ...catalogVisibleTitleWhere }, select: { id: true } });
    if (valid) {
      const { listId } = await activeList(locale);
      await addTitleItem(listId, titleId);
    }
  }
  redirect(`/${locale}/plan`);
}

// Toggle a title's membership in one SavedList, addressed by titleId — the
// catalog card's "add to list" checklist knows the title + desired state, not
// a SavedListItem id. Lets a buyer put the same publication on several lists
// from the popover without leaving the catalog. No redirect: called from a
// popover, not a full-page form.
export async function setListTitleMembership(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const titleId = str(formData, "titleId");
  const listId = str(formData, "listId");
  const member = str(formData, "member") === "1";
  const scope = await loadScope();
  if (titleId && listId) {
    const list = await prisma.savedList.findUnique({
      where: { id: listId },
      select: { organizationId: true, archivedAt: true },
    });
    if (list && !list.archivedAt && canActOnOrg(scope, list.organizationId)) {
      if (member) {
        const valid = await prisma.title.findFirst({
          where: { id: titleId, ...catalogVisibleTitleWhere },
          select: { id: true },
        });
        if (valid) await addTitleItem(listId, titleId);
      } else {
        // Drop both a title placeholder line AND an already-resolved product
        // line of this title — the checklist only knows "on this list or not".
        await prisma.savedListItem.deleteMany({
          where: { listId, OR: [{ titleId }, { product: { titleId } }] },
        });
      }
    }
  }
  revalidatePath(`/${locale}/catalog`);
  revalidatePath(`/${locale}/plan`);
  revalidatePath(`/${locale}/lists`);
}

// Create a brand-new SavedList and seed it with one title in a single popover
// action ("+ New list" inside "add to list"). No redirect — stays on the
// catalog page.
export async function createListWithTitle(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const titleId = str(formData, "titleId");
  const scope = await loadScope();
  const orgId = scope.workspace?.activeOrgId;
  if (scope.userId && orgId && titleId) {
    const valid = await prisma.title.findFirst({
      where: { id: titleId, ...catalogVisibleTitleWhere },
      select: { id: true },
    });
    if (valid) {
      const list = await prisma.savedList.create({
        data: { organizationId: orgId, name: str(formData, "name") || "Untitled list", createdById: scope.userId },
      });
      await addTitleItem(list.id, titleId);
      await recordAudit(scope.userId, "list.create", `SavedList:${list.id}`, { orgId });
    }
  }
  revalidatePath(`/${locale}/catalog`);
  revalidatePath(`/${locale}/plan`);
  revalidatePath(`/${locale}/lists`);
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

// Campaign flow — set a shortlist item's schedule (first period + unit count).
// The UI enforces the product minimum via the input; we store what's posted and
// leave validation to the estimate/submit path. updateMany no-ops if removed.
export async function setItemSchedule(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  await ownItem(locale, itemId);
  const startRaw = str(formData, "scheduleStart");
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? new Date(`${startRaw}T00:00:00Z`) : null;
  const units = Number(str(formData, "scheduleUnits"));
  await prisma.savedListItem.updateMany({
    where: { id: itemId },
    data: {
      scheduleStart: start,
      scheduleUnits: Number.isFinite(units) && units > 0 ? Math.floor(units) : null,
    },
  });
  redirect(safeReturnTo(formData, locale, "/plan"));
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

// Which verticals THIS plan is targeting — drives its own catalog-relevance
// ranking (see loadRelevanceSignals), independent of any other plan the org
// runs. Saved instantly (not gated behind full RFQ submission) so it takes
// effect the moment the buyer switches back to browsing the catalog.
export async function setListTargetVerticals(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const scope = await loadScope();
  const list = await prisma.savedList.findUnique({ where: { id: listId }, select: { organizationId: true } });
  if (list && canActOnOrg(scope, list.organizationId)) {
    const verticals = formData.getAll("targetVerticals").map((v) => String(v).trim()).filter(Boolean);
    await prisma.savedList.update({
      where: { id: listId },
      data: { targetVerticals: verticals.length ? verticals.join(",") : null },
    });
  }
  revalidatePath(`/${locale}/plan`);
  revalidatePath(`/${locale}/catalog`);
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
