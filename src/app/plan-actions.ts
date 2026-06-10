"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  clampQuantity,
  readBasket,
  writeBasket,
  type BasketItem,
} from "@/lib/basket";
import { recordAudit } from "@/lib/audit";
import { loadScope, canActOnOrg } from "@/lib/scope";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function addToPlan(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const productId = str(formData, "productId");
  if (productId) {
    const items = await readBasket();
    const existing = items.find((i) => i.productId === productId);
    if (existing) existing.quantity += 1;
    else items.push({ productId, quantity: 1 });
    await writeBasket(items);
  }
  redirect(`/${locale}/plan`);
}

export async function addRecommendedPlan(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const ids = str(formData, "productIds")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length > 0) {
    const valid = await prisma.product.findMany({
      where: { id: { in: ids }, active: true, bookable: true },
      select: { id: true },
    });
    const validIds = new Set(valid.map((p) => p.id));
    const items = await readBasket();
    for (const id of ids) {
      if (!validIds.has(id)) continue;
      const existing = items.find((i) => i.productId === id);
      if (existing) existing.quantity += 1;
      else items.push({ productId: id, quantity: 1 });
    }
    await writeBasket(items);
  }
  redirect(`/${locale}/plan`);
}

export async function removeFromPlan(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const productId = str(formData, "productId");
  const items = (await readBasket()).filter((i) => i.productId !== productId);
  await writeBasket(items);
  revalidatePath(`/${locale}/plan`);
}

// Set the quantity for one plan line directly (the plan-page stepper).
// addToPlan keeps incrementing on catalog re-add; this lets the buyer
// set an exact value. Clamped to [1, MAX_QTY]; never removes a line
// (Remove is its own action).
export async function setQuantity(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const productId = str(formData, "productId");
  const qty = clampQuantity(Number(str(formData, "quantity")));
  if (productId) {
    const items = await readBasket();
    const existing = items.find((i) => i.productId === productId);
    if (existing) {
      existing.quantity = qty;
      await writeBasket(items);
    }
  }
  redirect(`/${locale}/plan`);
}

// Toggle whether NativeSpin produces the content for one plan line.
// Drives a CONTENT_FEE quote line at submit time. withContent="1" turns
// it on, anything else off.
export async function setContentProduction(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const productId = str(formData, "productId");
  const on = str(formData, "withContent") === "1";
  if (productId) {
    const items = await readBasket();
    const existing = items.find((i) => i.productId === productId);
    if (existing) {
      existing.withContent = on;
      await writeBasket(items);
    }
  }
  redirect(`/${locale}/plan`);
}

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
  const stillActive = await prisma.product.findMany({
    where: {
      id: { in: sourceItems.map((i) => i.productId) },
      active: true,
      bookable: true,
    },
    select: { id: true },
  });
  const activeIds = new Set(stillActive.map((p) => p.id));
  const items: BasketItem[] = sourceItems
    .filter((i) => activeIds.has(i.productId))
    .map((i) => ({ productId: i.productId, quantity: i.quantity }));

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
