"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { writeActiveListId } from "@/lib/lists";
import { clampQuantity } from "@/lib/basket";
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

// "Use as template" — rehydrate a past Plan tied to an Order into a fresh
// SavedList, then make it the active list. Closes Maja R2's gap: returning
// customers who want to repeat what worked shouldn't rebuild the list title
// by title. The new list is editable in /plan before the buyer re-submits
// the RFQ.
//
// Authorisation: the order's organisation must be in the caller's
// scope (own org or, for agencies, the selected client). Anything
// else gets a redirect — no leaking of list structure across orgs.
//
// Products that have been deactivated since the original order are
// dropped from the rehydrated list; the buyer sees a count message
// at /plan and can find substitutes via the catalog.
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
                    select: { productId: true, quantity: true },
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

  const sourceItems = order.quote.request.plan.items;
  if (sourceItems.length === 0) {
    redirect(`/${locale}/plan?duplicate=empty`);
  }

  // Drop products that have been deactivated since the original order
  // ran. The buyer is told how many items survived so they don't
  // discover the loss after submitting. PlanItem.productId is now
  // nullable (title placeholders), but `duplicatePlan` only ever runs
  // against confirmed orders whose plan items are product-backed —
  // filter the nulls so the rehydrated list stays well-typed.
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
  // new (listId,productId) unique would reject duplicate rows, so merge their
  // quantities (clamped) into one line per product.
  const byProduct = new Map<string, number>();
  for (const i of survivingItems) {
    const pid = i.productId as string;
    byProduct.set(pid, clampQuantity((byProduct.get(pid) ?? 0) + i.quantity));
  }
  const lines = [...byProduct.entries()];

  const created = await prisma.savedList.create({
    data: {
      organizationId: order.organizationId,
      name: "Reordered campaign",
      createdById: scope.userId ?? null,
      items: {
        create: lines.map(([productId, quantity], idx) => ({
          productId,
          titleId: null,
          quantity,
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
