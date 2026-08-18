"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { OrderStatus, BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg, notifyPublisher } from "@/lib/notify";
import { requireDesk } from "@/lib/desk-guard";
import { findDueWaves } from "@/lib/programme";
import {
  canCancelOrder,
  cancelBlockReason,
  normaliseReason,
  type CancelActor,
} from "@/lib/cancellation";

const ORDER_FLOW: OrderStatus[] = [
  "CONFIRMED",
  "IN_PRODUCTION",
  "SCHEDULED",
  "LIVE",
  "COMPLETED",
];

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function advanceOrder(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const userId = await requireDesk(locale);

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (order) {
    const idx = ORDER_FLOW.indexOf(order.status);
    if (idx >= 0 && idx < ORDER_FLOW.length - 1) {
      const next = ORDER_FLOW[idx + 1];
      await prisma.order.update({
        where: { id: order.id },
        data: { status: next },
      });
      await recordAudit(userId, "order.advance", `Order:${order.id}`, {
        from: order.status,
        to: next,
      });
      if (next === "COMPLETED") {
        // The buyer's cue to plan the next wave. If this order was a wave of
        // a programme and the following wave is now due, send them to Home,
        // where the "next wave due" card opens that wave (a bare /plan link
        // would show whichever list happens to be active); otherwise to the
        // finished order, which offers "Plan next wave" (a full copy of the
        // list, ready to edit).
        const planName = await orderPlanName(order.id);
        const due = (await findDueWaves([order.organizationId], new Date()))[0] ?? null;
        await notifyOrg(order.organizationId, {
          kind: "ORDER_COMPLETED",
          title: `Campaign finished: ${planName}`,
          body: due
            ? `Wave ${due.waveNumber} of ${due.plannedWaves} is ready to send${
                due.articleAngle ? ` — angle: ${due.articleAngle}` : ""
              }. A fresh article now, while readers still remember the last one, is what turns one placement into a campaign that sticks.`
            : `Your placements have run. Native works through repetition — plan the next wave with a fresh article angle while readers still remember this one.`,
          link: due ? `/${locale}/home` : `/${locale}/orders/${order.id}`,
        });
      } else {
        await notifyOrg(order.organizationId, {
          kind: "ASSET_REVIEW",
          title: `Order ${next.toLowerCase().replace(/_/g, " ")}`,
          link: `/${locale}/orders/${order.id}`,
        });
      }
    }
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}

async function orderPlanName(orderId: string): Promise<string> {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: { quote: { select: { request: { select: { plan: { select: { name: true } } } } } } },
  });
  return o?.quote.request.plan.name ?? "your campaign";
}

// Update the post-order follow-up commitment note on the order. Lets
// the desk capture forward-looking commercial advisory text ("Q1-2027
// Berlingske Weekend contingent on Q3 KPI" — Petter scenario) without
// rotting it in the desk associate's head when they change role.
// Empty input clears the note.
export async function updateNextEngagementNote(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const note = field(formData, "note").slice(0, 2000);
  const userId = await requireDesk(locale);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!order) {
    redirect(`/${locale}/desk/orders/${orderId}?neng=not-found`);
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { nextEngagementNote: note.length ? note : null },
  });
  await recordAudit(userId, "order.next_engagement_note_updated", `Order:${orderId}`, {
    length: note.length,
  });
  revalidatePath(`/${locale}/desk/orders/${orderId}`);
  revalidatePath(`/${locale}/orders/${orderId}`);
  redirect(`/${locale}/desk/orders/${orderId}?neng=ok`);
}

// Cancel an order. Surfaced from both the desk console (operations
// decided to kill the booking) and indirectly from the publisher
// editorial-veto flow (publisher-actions.ts → rejectAsset escalates
// here once the asset is retracted on a confirmed order).
//
// Guarded by `canCancelOrder` so the desk can't accidentally cancel
// something that's already LIVE / COMPLETED / INVOICED — the safe path
// in those cases is a credit note, which is a separate concern.
//
// Side-effects fan out:
//   - any in-flight PublisherBooking row on this order goes to
//     BookingStatus.CANCELLED so the publisher portal stops showing
//     the order as something they need to publish
//   - buyer org + publisher both receive an ORDER_CANCELLED
//     notification with the reason, so neither learns about it from
//     calendar absence
//   - audit row records actor + reason for any later dispute
export async function cancelOrder(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const reason = normaliseReason(field(formData, "reason"));
  const userId = await requireDesk(locale);

  if (!reason) {
    redirect(`/${locale}/desk/orders/${orderId}?cancel=reason-required`);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { lines: { include: { booking: true } } },
  });
  if (!order) {
    redirect(`/${locale}/desk/orders/${orderId}?cancel=not-found`);
  }
  if (!canCancelOrder(order.status)) {
    redirect(
      `/${locale}/desk/orders/${orderId}?cancel=` +
        encodeURIComponent(cancelBlockReason(order.status)),
    );
  }

  const session = await auth();
  const role = session?.user?.role;
  const actor: CancelActor =
    role === "SUPERADMIN" ? "SUPERADMIN" : "DESK";

  // OrderLine has no direct `product` relation in the schema, so we
  // pull the publisher chain in a separate query rather than include.
  const lineProducts = await prisma.product.findMany({
    where: {
      id: {
        in: order.lines
          .map((l) => l.productId)
          .filter((id): id is string => !!id),
      },
    },
    select: { title: { select: { publisherId: true } } },
  });
  const publisherIds = Array.from(
    new Set(
      lineProducts
        .map((p) => p.title.publisherId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  await prisma.$transaction([
    prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: reason,
        cancelledBy: actor,
      },
    }),
    prisma.publisherBooking.updateMany({
      where: {
        orderLineId: { in: order.lines.map((l) => l.id) },
        status: { notIn: [BookingStatus.PUBLISHED, BookingStatus.CONFIRMED] },
      },
      data: { status: BookingStatus.CANCELLED },
    }),
  ]);

  await recordAudit(userId, "order.cancel", `Order:${order.id}`, {
    from: order.status,
    reason,
    actor,
  });

  await notifyOrg(order.organizationId, {
    kind: "ORDER_CANCELLED",
    title: "Order cancelled",
    body: reason,
    link: `/${locale}/orders/${order.id}`,
  });
  // Notify each distinct publisher whose title was on the order so
  // their portal stops showing the booking as in-flight.
  await Promise.all(
    publisherIds.map((pid) =>
      notifyPublisher(pid, {
        kind: "ORDER_CANCELLED",
        title: "Order cancelled by NativeSpin desk",
        body: reason,
        link: `/${locale}/publisher/orders`,
      }),
    ),
  );

  redirect(`/${locale}/desk/orders/${order.id}`);
}

// Resolve a Title placeholder on a submitted Request's Plan to a concrete
// product, so the request can be quoted. This is the desk-side counterpart of
// the buyer's resolveTitleLine (which acts on SavedListItem); here it acts on
// the snapshotted PlanItem. Without it, a buyer who asked the desk to "propose
// a placement" would have that line silently dropped from the quote/order, and
// an all-title request could never be quoted at all. Desk-only; the chosen
// product MUST belong to the placeholder's own title (no cross-publisher swap).
export async function resolvePlanTitleItem(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireDesk(locale);
  const planItemId = field(formData, "planItemId");
  const productId = field(formData, "productId");
  const requestId = field(formData, "requestId");

  const item = await prisma.planItem.findUnique({
    where: { id: planItemId },
    select: { id: true, productId: true, titleId: true },
  });
  // Only an unresolved placeholder (titleId set, productId null) is resolvable.
  if (item && !item.productId && item.titleId) {
    const product = await prisma.product.findFirst({
      where: { id: productId, titleId: item.titleId, active: true, bookable: true },
      select: { id: true },
    });
    if (product) {
      await prisma.planItem.update({
        where: { id: planItemId },
        data: { productId, titleId: null },
      });
      await recordAudit(userId, "plan.resolveTitle", `PlanItem:${planItemId}`, {
        productId,
        requestId,
      });
      // Signal the buyer org that the placement they asked the desk to propose
      // has been chosen (the "desk proposes" flow was previously silent to them).
      const req = await prisma.request.findUnique({
        where: { id: requestId },
        select: { organizationId: true },
      });
      if (req) {
        await notifyOrg(req.organizationId, {
          kind: "PLACEMENT_PROPOSED",
          title: "A placement was proposed for your request",
          body: "Our desk selected a specific placement for a publication you asked it to propose. Review it on your request.",
          link: `/${locale}/requests/${requestId}`,
        });
      }
    }
  }
  revalidatePath(`/${locale}/desk/${requestId}`);
  redirect(`/${locale}/desk/${requestId}`);
}

// Drop an unresolved Title placeholder from a Request's Plan. Recovery path for
// a placeholder whose title has NO bookable placement (otherwise the request is
// stuck unquotable forever). Desk-only; a product LINE can't be dropped here —
// only an unresolved placeholder — so the buyer's firm ask is never silently
// amputated. Audited.
export async function removePlanTitleItem(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireDesk(locale);
  const planItemId = field(formData, "planItemId");
  const requestId = field(formData, "requestId");

  const item = await prisma.planItem.findUnique({
    where: { id: planItemId },
    select: { productId: true, titleId: true },
  });
  if (item && !item.productId && item.titleId) {
    await prisma.planItem.deleteMany({ where: { id: planItemId } });
    await recordAudit(userId, "plan.removeTitle", `PlanItem:${planItemId}`, { requestId });
    const req = await prisma.request.findUnique({
      where: { id: requestId },
      select: { organizationId: true },
    });
    if (req) {
      await notifyOrg(req.organizationId, {
        kind: "PLACEMENT_PROPOSED",
        title: "A placeholder was removed from your request",
        body: "Our desk removed a publication placeholder that had no bookable placement. The rest of your request is unaffected.",
        link: `/${locale}/requests/${requestId}`,
      });
    }
  }
  revalidatePath(`/${locale}/desk/${requestId}`);
  redirect(`/${locale}/desk/${requestId}`);
}
