"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { signinPath } from "@/lib/auth-gate";
import { appUrl } from "@/lib/url";
import { planPath } from "@/lib/plan-path";
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
  setItemContent,
  setItemAlternative,
  readActiveListId,
  writeActiveListId,
  clearActiveListId,
  migrateLegacyBasket,
  loadListWithItems,
} from "@/lib/lists";
import { planBarSummary, type PlanBarSummary } from "@/lib/plan-total";
import { loadPricingDefaults } from "@/lib/content-fee";
import { enableListShare, disableListShare } from "@/lib/list-share";
import { normalizeLineNote } from "@/lib/line-note";
import { contentIntent } from "@/lib/authorship";
import { reorderSection, ReorderMismatchError } from "@/lib/plan-reorder";
import { alignActivePlan, resolvePlanTarget, type PlanTargetList } from "@/lib/plan-target";
import { saveListBrief, type RawListBrief } from "@/lib/plan-brief";
import type { Scope } from "@/lib/scope";

// Same-origin path of the page that posted the action, if the browser said.
async function refererPath(): Promise<string | null> {
  const referer = (await headers()).get("referer");
  if (!referer) return null;
  try {
    const url = new URL(referer);
    return url.origin === new URL(appUrl()).origin ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requireActiveOrg(locale: string) {
  const scope = await loadScope();
  const orgId = scope.workspace?.activeOrgId;
  // Signed out (e.g. "Add all to plan" on the public recommender): send them
  // to sign in and back to the page they acted on, not to a bare /signin that
  // forgets what they were doing.
  if (!scope.userId) redirect(signinPath(locale, await refererPath()));
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
 *  lock, so a first-add race converges on one list rather than orphaning one.
 *  A form on /plan/<listId> posts its listId: that plan wins over the cookie
 *  (see ownList), so an add from the page lands on the plan the page shows. */
async function activeList(locale: string, postedListId = "") {
  if (postedListId) {
    const { scope, list } = await ownList(locale, postedListId);
    await alignLinePlan(scope, list);
    return { scope, orgId: list.organizationId, listId: list.id };
  }
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
      const { listId } = await activeList(locale, str(formData, "listId"));
      await addProductItem(listId, productId, str(formData, "withContent") === "1");
      if (!str(formData, "returnTo")) redirect(planPath(locale, listId));
    }
  }
  redirect(safeReturnTo(formData, locale, "/plan"));
}

export type ShortlistAddResult =
  // `plan`: the plan bar's state after the add, priced by the server exactly
  // as /plan prices it (planBarSummary). The browser never prices anything.
  | { ok: true; listId: string; plan: PlanBarSummary }
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
  const [list, pricing] = await Promise.all([loadListWithItems(listId), loadPricingDefaults()]);
  revalidatePath(`/${locale}/plan`, "layout");
  revalidatePath(`/${locale}/requests`);
  return { ok: true, listId, plan: planBarSummary(list?.items ?? [], pricing) };
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
  revalidatePath(`/${locale}/plan`, "layout");
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
  revalidatePath(`/${locale}/plan`, "layout");
  revalidatePath(`/${locale}/lists`);
}

/** Shared guard for line actions: the item's list must be in the caller's
 *  scope and not archived. The list comes from the ITEM, never from the
 *  active-list cookie, so an edit in a tab showing plan A stays on plan A even
 *  after another tab opened plan B. Afterwards that plan is made the active
 *  one again (alignLinePlan) and the action lands on its own /plan/<listId>. */
async function ownItem(locale: string, itemId: string) {
  const scope = await loadScope();
  const item = itemId
    ? await prisma.savedListItem.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          productId: true,
          titleId: true,
          list: { select: { id: true, organizationId: true, archivedAt: true } },
        },
      })
    : null;
  if (!item || item.list.archivedAt || !canActOnOrg(scope, item.list.organizationId)) {
    redirect(planPath(locale, null, { error: "plan-unavailable" }));
  }
  return { scope, item, list: { id: item.list.id, organizationId: item.list.organizationId } };
}

/** After a line action: make the edited plan the active one for a buyer
 *  working in that org (the desk has no workspace and no active plan). */
async function alignLinePlan(scope: Scope, list: PlanTargetList) {
  if (scope.workspace?.scopeOrgIds.includes(list.organizationId)) {
    await alignActivePlan(scope.workspace, list);
  }
}

/** Guard for actions addressed by a posted listId (rename, targeting, share,
 *  brief): the same rules as submit (lib/plan-target.ts). */
async function ownList(locale: string, listId: string) {
  const scope = await loadScope();
  if (!scope.userId) redirect(signinPath(locale, await refererPath()));
  const target = await resolvePlanTarget(scope.workspace, listId);
  if (!target.ok) redirect(planPath(locale, null, { error: "plan-unavailable" }));
  return { scope, list: target.list };
}

export async function removeListItem(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  const { scope, list } = await ownItem(locale, itemId);
  await removeItem(itemId);
  await alignLinePlan(scope, list);
  revalidatePath(`/${locale}/plan`, "layout");
}

export async function setListItemQuantity(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  const { scope, list } = await ownItem(locale, itemId);
  await setItemQuantity(itemId, Number(str(formData, "quantity")));
  await alignLinePlan(scope, list);
  revalidatePath(`/${locale}/plan`, "layout");
}

export async function setListItemContent(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  const { scope, list } = await ownItem(locale, itemId);
  await setItemContent(itemId, str(formData, "withContent") === "1");
  await alignLinePlan(scope, list);
  redirect(planPath(locale, list.id));
}

// Customer-visible line note ("Merknad") — shown on /plan and the /share view
// and carried onto the quote. Anyone who can act on the list's org may edit it.
export async function setListItemNote(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  const { scope, list } = await ownItem(locale, itemId);
  await alignLinePlan(scope, list);
  const parsed = normalizeLineNote(formData.get("note"));
  if (!parsed.ok) redirect(planPath(locale, list.id, { error: "note-too-long" }));
  await prisma.savedListItem.updateMany({ where: { id: itemId }, data: { notes: parsed.note } });
  await recordAudit(scope.userId ?? null, "list.item_note", `SavedListItem:${itemId}`, {
    cleared: parsed.note === null,
  });
  redirect(planPath(locale, list.id));
}

// Move a line between the plan and its recommended alternatives. An
// alternative is never counted in totals or submitted (lib/lists.ts
// committedItems); "Legg til i planen" is the only way it becomes buyable.
export async function setListItemAlternative(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  const { scope, list } = await ownItem(locale, itemId);
  const isAlternative = str(formData, "isAlternative") === "1";
  await setItemAlternative(itemId, isAlternative);
  await recordAudit(scope.userId ?? null, "list.item_alternative", `SavedListItem:${itemId}`, { isAlternative });
  await alignLinePlan(scope, list);
  redirect(planPath(locale, list.id));
}

// Reorder one section of a plan (the plan lines or its alternatives) —
// drag-and-drop (pointer or keyboard) and one-click sort both end here. Section
// membership comes from the database, never from the client; the id list must
// be exactly that section (lib/plan-reorder.ts), so a stale tab is refused
// rather than silently reshuffling lines it never saw. No redirect: the client
// already shows the new order, and a same-route re-navigation is what breaks
// soft nav on this app (see catalog). Returns ok=false when refused so the UI
// can reload the page to the server's order.
export async function reorderListItems(input: {
  listId: string;
  section: "plan" | "alternatives";
  itemIds: string[];
}): Promise<{ ok: boolean }> {
  const scope = await loadScope();
  const list = await prisma.savedList.findUnique({
    where: { id: input.listId },
    select: {
      organizationId: true,
      archivedAt: true,
      items: { select: { id: true, sortOrder: true, createdAt: true, isAlternative: true } },
    },
  });
  if (!list || list.archivedAt || !canActOnOrg(scope, list.organizationId)) return { ok: false };
  const sectionIds = list.items
    .filter((i) => i.isAlternative === (input.section === "alternatives"))
    .map((i) => i.id);
  let rows: { id: string; sortOrder: number }[];
  try {
    rows = reorderSection(list.items, sectionIds, input.itemIds);
  } catch (err) {
    if (err instanceof ReorderMismatchError) return { ok: false };
    throw err;
  }
  const changed = rows.filter((r) => list.items.find((i) => i.id === r.id)?.sortOrder !== r.sortOrder);
  if (changed.length === 0) return { ok: true };
  await prisma.$transaction(
    changed.map((r) => prisma.savedListItem.update({ where: { id: r.id }, data: { sortOrder: r.sortOrder } })),
  );
  await recordAudit(scope.userId ?? null, "list.reordered", `SavedList:${input.listId}`, {
    section: input.section,
    count: input.itemIds.length,
  });
  return { ok: true };
}

// Campaign flow — set a shortlist item's schedule (first period + unit count).
// The UI enforces the product minimum via the input; we store what's posted and
// leave validation to the estimate/submit path. updateMany no-ops if removed.
export async function setItemSchedule(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  const { scope, list } = await ownItem(locale, itemId);
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
  await alignLinePlan(scope, list);
  // The campaign flow passes its own returnTo; /plan's inline date form lands
  // back on the plan it edited.
  redirect(str(formData, "returnTo") ? safeReturnTo(formData, locale, "/plan") : planPath(locale, list.id));
}

export async function resolveTitleLine(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const itemId = str(formData, "itemId");
  const productId = str(formData, "productId");
  const { scope, item, list } = await ownItem(locale, itemId);
  await alignLinePlan(scope, list);
  // Only a title placeholder is resolvable, and ONLY to a product OF THAT TITLE —
  // a tampered/replayed POST can't swap in a different publisher's product.
  if (!item.titleId) redirect(planPath(locale, list.id));
  const product = await prisma.product.findFirst({
    where: { id: productId, titleId: item.titleId, active: true, bookable: true },
    select: { id: true },
  });
  if (product) await resolveTitleItem(itemId, productId);
  redirect(planPath(locale, list.id));
}

export async function createList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const { scope, orgId } = await requireActiveOrg(locale);
  const list = await prisma.savedList.create({
    data: { organizationId: orgId, name: str(formData, "name") || "Untitled list", createdById: scope.userId ?? null },
  });
  await writeActiveListId(list.id);
  await recordAudit(scope.userId ?? null, "list.create", `SavedList:${list.id}`, { orgId });
  redirect(planPath(locale, list.id));
}

export async function selectActiveList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const { scope, list } = await ownList(locale, str(formData, "listId"));
  await alignLinePlan(scope, list);
  redirect(planPath(locale, list.id));
}

export async function renameList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const { scope, list } = await ownList(locale, str(formData, "listId"));
  await prisma.savedList.update({ where: { id: list.id }, data: { name: str(formData, "name") || "Untitled list" } });
  await alignLinePlan(scope, list);
  revalidatePath(`/${locale}/plan`, "layout");
  revalidatePath(`/${locale}/lists`);
}

// Which verticals THIS plan is targeting — drives its own catalog-relevance
// ranking (see loadRelevanceSignals), independent of any other plan the org
// runs. Saved instantly (not gated behind full RFQ submission) so it takes
// effect the moment the buyer switches back to browsing the catalog.
export async function setListTargetVerticals(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const { scope, list } = await ownList(locale, str(formData, "listId"));
  const verticals = formData.getAll("targetVerticals").map((v) => String(v).trim()).filter(Boolean);
  await prisma.savedList.update({
    where: { id: list.id },
    data: { targetVerticals: verticals.length ? verticals.join(",") : null },
  });
  await alignLinePlan(scope, list);
  revalidatePath(`/${locale}/plan`, "layout");
  revalidatePath(`/${locale}/catalog`);
}

export type SavePlanBriefResult = { ok: boolean };

// Autosave of /plan's brief fields, called by the form as the buyer types (not
// a <form action>: no navigation, no re-render that would reset the inputs).
// The brief belongs to the plan the page shows, addressed by its listId.
export async function savePlanBrief(listId: string, brief: RawListBrief): Promise<SavePlanBriefResult> {
  const scope = await loadScope();
  if (!scope.userId) return { ok: false };
  const target = await resolvePlanTarget(scope.workspace, listId);
  if (!target.ok) return { ok: false };
  await saveListBrief(target.list.id, brief);
  return { ok: true };
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

// Client-share link: enable mints a fresh token (re-enabling never revives a
// link that already circulated), disable kills it instantly. Owner-guarded
// like every other list mutation; the public page itself does the lookup by
// token only.
export async function shareList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const { scope, list } = await ownList(locale, str(formData, "listId"));
  await enableListShare(list.id);
  await recordAudit(scope.userId ?? null, "list.share_enable", `SavedList:${list.id}`, {});
  await alignLinePlan(scope, list);
  redirect(planPath(locale, list.id));
}

export async function unshareList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const { scope, list } = await ownList(locale, str(formData, "listId"));
  await disableListShare(list.id);
  await recordAudit(scope.userId ?? null, "list.share_disable", `SavedList:${list.id}`, {});
  await alignLinePlan(scope, list);
  redirect(planPath(locale, list.id));
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
      // The brief is part of the plan, so the copy starts from it too.
      briefText: source.briefText,
      briefTiming: source.briefTiming,
      budget: source.budget,
      currency: source.currency,
      goal: source.goal,
      targetAudience: source.targetAudience,
      targetGeo: source.targetGeo,
      targetContext: source.targetContext,
      targetVerticals: source.targetVerticals,
      createdById: scope.userId ?? null,
      items: {
        create: source.items.map((i) => ({
          productId: i.productId,
          titleId: i.titleId,
          quantity: i.quantity,
          ...contentIntent(i.withContent, i.authorshipMode),
          notes: i.notes,
          isAlternative: i.isAlternative,
          sortOrder: i.sortOrder,
        })),
      },
    },
  });
  await writeActiveListId(copy.id);
  await recordAudit(scope.userId ?? null, "list.duplicate", `SavedList:${copy.id}`, { sourceId: listId });
  redirect(planPath(locale, copy.id));
}
