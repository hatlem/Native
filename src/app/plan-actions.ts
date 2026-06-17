"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { writeBasket, type BasketItem } from "@/lib/basket";
import { recordAudit } from "@/lib/audit";
import { loadScope, canActOnOrg } from "@/lib/scope";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export {
  addProductToList as addToPlan,
  addRecommendedToList as addRecommendedPlan,
  removeListItem as removeFromPlan,
  setListItemQuantity as setQuantity,
  setListItemContent as setContentProduction,
} from "@/app/list-actions";

// "Use as template" — rehydrate the in-flight basket cookie from a past
// Plan tied to an Order. Closes Maja R2's gap: returning customers
// who want to repeat what worked shouldn't rebuild the basket title
// by title. The new in-flight plan is editable in /plan before the
// buyer re-submits the RFQ.
//
// Authorisation: the order's organisation must be in the caller's
// scope (own org or, for agencies, the selected client). Anything
// else gets a redirect — no leaking of basket structure across orgs.
//
// Products that have been deactivated since the original order are
// dropped from the rehydrated basket; the buyer sees a count message
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
  // discover the loss after submitting.
  // TODO(Task 8): rewrite onto SavedList. PlanItem.productId is now nullable
  // (title placeholders), but `duplicatePlan` only ever runs against confirmed
  // orders whose plan items are always product-backed — filter the nulls so
  // the rehydrated basket stays well-typed.
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
  const items: BasketItem[] = productSourceItems
    .filter((i) => activeIds.has(i.productId as string))
    .map((i) => ({ productId: i.productId as string, quantity: i.quantity }));

  await writeBasket(items);
  await recordAudit(
    scope.userId,
    "plan.duplicate",
    `Order:${orderId}`,
    {
      sourcePlanId: order.quote.request.plan.id,
      restored: items.length,
      dropped: sourceItems.length - items.length,
    },
  );

  const dropped = sourceItems.length - items.length;
  redirect(
    `/${locale}/plan?duplicate=` +
      (items.length === 0
        ? "all-inactive"
        : dropped > 0
          ? `partial-${dropped}`
          : "ok"),
  );
}
