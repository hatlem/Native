"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { writeActiveListId } from "@/lib/lists";
import { clampQuantity } from "@/lib/basket";
import { sourceListForOrder, copyListForNewWave } from "@/lib/programme";
import {
  addProductToList,
  addRecommendedToList,
  removeListItem,
  setListItemQuantity,
  setListItemContent,
} from "@/app/list-actions";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Stable buyer-facing action names, kept as the import surface for the
// catalog / plan / recommend components. A "use server" module may only
// EXPORT async functions (no `export { x as y } from …` re-exports), so
// these delegate to the canonical list actions rather than re-exporting.
export async function addToPlan(formData: FormData) {
  return addProductToList(formData);
}
export async function addRecommendedPlan(formData: FormData) {
  return addRecommendedToList(formData);
}
export async function removeFromPlan(formData: FormData) {
  return removeListItem(formData);
}
export async function setQuantity(formData: FormData) {
  return setListItemQuantity(formData);
}
export async function setContentProduction(formData: FormData) {
  return setListItemContent(formData);
}

// "Plan next wave" (formerly "Use as template") — start a fresh, editable
// list from a past order and make it the active list, so a returning buyer
// never rebuilds a plan title by title (Maja R2's gap).
//
// Preferred path: the order still traces back to the SavedList it was
// submitted from (Request.sourceListId) — copy THAT in full: budget, brief,
// targeting, targetVerticals, per-line content mode, notes, schedule. The
// copy is deliberately NOT enrolled in the source's programme (a finished
// programme's wave 3 shouldn't spawn "wave 4" implicitly); the buyer can
// start a new programme from the copy on /plan.
//
// Fallback: no source list (API-created orders, purged lists) — rehydrate
// from the Plan's items, dropping products deactivated since, and tell the
// buyer how many survived (the ?duplicate= banners).
//
// Authorisation: the order's organisation must be in the caller's scope
// (own org or, for agencies, the selected client).
export async function duplicatePlan(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const orderId = str(formData, "orderId");

  const scope = await loadScope();
  if (!scope.userId) {
    redirect(`/${locale}/signin`);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      organizationId: true,
      quote: {
        select: {
          request: {
            select: {
              plan: {
                select: {
                  id: true,
                  items: {
                    select: {
                      productId: true,
                      quantity: true,
                      withContent: true,
                      authorshipMode: true,
                      notes: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) {
    redirect(`/${locale}/orders`);
  }
  if (!canActOnOrg(scope, order.organizationId)) {
    redirect(`/${locale}/orders`);
  }

  const sourceList = await sourceListForOrder(orderId);
  if (sourceList && sourceList.organizationId === order.organizationId && sourceList.items.length > 0) {
    // Any line whose product was deactivated since is dropped here too, so the
    // copy never carries a line submit would refuse.
    const productIds = sourceList.items.map((i) => i.productId).filter((id): id is string => !!id);
    const live = new Set(
      (
        await prisma.product.findMany({
          where: { id: { in: productIds }, active: true, bookable: true },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    const survivingItems = sourceList.items.filter((i) => !i.productId || live.has(i.productId));
    const dropped = sourceList.items.length - survivingItems.length;
    if (survivingItems.length === 0) redirect(`/${locale}/plan?duplicate=all-inactive`);

    const baseName = sourceList.name.replace(/\s*·\s*Wave \d+$/i, "");
    const createdId = await prisma.$transaction((tx) =>
      copyListForNewWave(
        { ...sourceList, items: survivingItems },
        { name: `${baseName} · next wave`, shiftWeeks: 0, resetSchedule: true, createdById: scope.userId ?? null },
        tx,
      ),
    );
    await writeActiveListId(createdId);
    await recordAudit(scope.userId, "plan.duplicate", `Order:${orderId}`, {
      sourceListId: sourceList.id,
      restored: survivingItems.length,
      dropped,
    });
    redirect(`/${locale}/plan?duplicate=${dropped > 0 ? `partial-${dropped}` : "ok"}`);
  }

  const sourceItems = order.quote.request.plan.items;
  if (sourceItems.length === 0) {
    redirect(`/${locale}/plan?duplicate=empty`);
  }

  // Drop products that have been deactivated since the original order
  // ran. The buyer is told how many items survived so they don't
  // discover the loss after submitting. PlanItem.productId is nullable
  // (title placeholders) — filter the nulls so the rehydrated list stays
  // well-typed.
  const productSourceItems = sourceItems.filter((i) => i.productId);
  const stillActive = await prisma.product.findMany({
    where: {
      id: { in: productSourceItems.map((i) => i.productId as string) },
      active: true,
      bookable: true,
    },
    select: { id: true },
  });
  const activeIds = new Set(stillActive.map((p) => p.id));
  const survivingItems = productSourceItems.filter((i) =>
    activeIds.has(i.productId as string),
  );

  // Dedup by productId — an order can carry the same product across multiple
  // PlanItems (e.g. two desk-resolved title lines for the same product). The
  // (listId,productId) unique would reject duplicate rows, so merge their
  // quantities (clamped) into one line per product; content mode is OR-ed.
  const byProduct = new Map<
    string,
    { quantity: number; withContent: boolean; authorshipMode: (typeof survivingItems)[number]["authorshipMode"]; notes: string | null }
  >();
  for (const i of survivingItems) {
    const pid = i.productId as string;
    const prev = byProduct.get(pid);
    byProduct.set(pid, {
      quantity: clampQuantity((prev?.quantity ?? 0) + i.quantity),
      withContent: (prev?.withContent ?? false) || i.withContent,
      authorshipMode: i.withContent ? i.authorshipMode : (prev?.authorshipMode ?? i.authorshipMode),
      notes: prev?.notes ?? i.notes,
    });
  }
  const lines = [...byProduct.entries()];

  const created = await prisma.savedList.create({
    data: {
      organizationId: order.organizationId,
      name: "Reordered campaign",
      createdById: scope.userId ?? null,
      items: {
        create: lines.map(([productId, l], idx) => ({
          productId,
          titleId: null,
          quantity: l.quantity,
          withContent: l.withContent,
          authorshipMode: l.authorshipMode,
          notes: l.notes,
          sortOrder: idx,
        })),
      },
    },
  });
  await writeActiveListId(created.id);

  // "dropped" reflects lines lost to deactivation (not same-product merges).
  const dropped = sourceItems.length - survivingItems.length;
  await recordAudit(
    scope.userId,
    "plan.duplicate",
    `Order:${orderId}`,
    {
      sourcePlanId: order.quote.request.plan.id,
      restored: lines.length,
      dropped,
    },
  );

  redirect(
    `/${locale}/plan?duplicate=` +
      (lines.length === 0
        ? "all-inactive"
        : dropped > 0
          ? `partial-${dropped}`
          : "ok"),
  );
}
