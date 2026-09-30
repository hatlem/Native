"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { OrderStatus, BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { releaseInstantOrderList } from "@/lib/commerce/list-commit";
import { recordAudit } from "@/lib/audit";
import { notifyOrg, notifyPublisher } from "@/lib/notify";
import { requireDesk } from "@/lib/desk-guard";
import { findDueWaves } from "@/lib/programme";
import { orderNoticeContext } from "@/lib/notice-context";
import { deliveryGap, nextOrderStatus } from "@/lib/order-lifecycle";
import {
  canCancelOrder,
  normaliseReason,
  type CancelActor,
} from "@/lib/cancellation";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Move the order one step along ORDER_FLOW. LIVE and COMPLETED tell the
// buyer their campaign ran, so advancing into them while placements have
// no published link needs the desk's explicit confirmation (the order page
// lists what's missing), is audited as an override, and the buyer's email
// states the published count rather than claiming delivery.
export async function advanceOrder(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  // The status the desk saw when it clicked; a stale form (another tab
  // already advanced) must not skip a step or confirm the wrong gap.
  const expectedFrom = field(formData, "from");
  const confirmedUndelivered = formData.get("confirmUndelivered") === "on";
  const userId = await requireDesk(locale);
  const back = `/${locale}/desk/orders/${orderId}`;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lines: {
        select: {
          id: true,
          kind: true,
          booking: { select: { status: true, liveUrl: true } },
        },
      },
    },
  });
  if (order) {
    const next = nextOrderStatus(order.status);
    if (next) {
      if (expectedFrom && expectedFrom !== order.status) redirect(`${back}?advance=moved`);
      const gap = deliveryGap(
        order.lines.map((l) => ({ ...l, label: l.id })),
        next,
      );
      if (gap.needsConfirmation && !confirmedUndelivered) {
        redirect(`${back}?advance=unconfirmed`);
      }
      const moved = await prisma.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: next },
      });
      if (moved.count !== 1) redirect(`${back}?advance=moved`);
      await recordAudit(userId, "order.advance", `Order:${order.id}`, {
        from: order.status,
        to: next,
        placements: gap.total,
        published: gap.published.length,
        // Present only when the desk overrode the delivery guard.
        ...(gap.needsConfirmation
          ? { deliveryOverride: true, unpublishedLineIds: gap.missing.map((l) => l.id) }
          : {}),
      });
      const delivery = { published: gap.published.length, total: gap.total };
      if (next === "COMPLETED") {
        // The buyer's cue to plan the next wave. If this order was a wave of
        // a programme and the following wave is now due, send them to Home,
        // where the "next wave due" card opens that wave (a bare /plan link
        // would show whichever list happens to be active); otherwise to the
        // finished order, which offers "Plan next wave" (a full copy of the
        // list, ready to edit).
        const { planName } = await orderNoticeContext(order.id);
        const due = (await findDueWaves([order.organizationId], new Date()))[0] ?? null;
        // Templated (lib/notice-template.ts): each email and inbox row in
        // its reader's own language.
        await notifyOrg(order.organizationId, {
          kind: "ORDER_COMPLETED",
          template: {
            key: "orderCompleted",
            params: {
              planName,
              orderId: order.id,
              due: due
                ? {
                    waveNumber: due.waveNumber,
                    plannedWaves: due.plannedWaves,
                    articleTitle: due.articleTitle,
                  }
                : null,
              delivery,
            },
          },
        });
      } else if (next === "LIVE") {
        // Copy built from the evidence, not the status: "published" only
        // when every placement has a published link.
        const { planName } = await orderNoticeContext(order.id);
        await notifyOrg(order.organizationId, {
          kind: "ASSET_REVIEW",
          template: { key: "orderLive", params: { planName, orderId: order.id, ...delivery } },
        });
      } else if (next === "IN_PRODUCTION") {
        const { planName } = await orderNoticeContext(order.id);
        await notifyOrg(order.organizationId, {
          kind: "ASSET_REVIEW",
          template: {
            key: "orderInProduction",
            params: { planName, orderId: order.id, placements: gap.total },
          },
        });
      } else if (next === "SCHEDULED") {
        // The body names the flight window the desk set on the order, else
        // the span of the publishers' placement dates, else says there is
        // no date yet — never a bare "Order scheduled".
        const { planName } = await orderNoticeContext(order.id);
        const window = await scheduledWindow(order.id);
        await notifyOrg(order.organizationId, {
          kind: "ASSET_REVIEW",
          template: {
            key: "orderScheduled",
            params: {
              planName,
              orderId: order.id,
              startsOn: window.start?.toISOString() ?? null,
              endsOn: window.end?.toISOString() ?? null,
            },
          },
        });
      }
    }
  }
  redirect(back);
}

// The window a SCHEDULED order runs in: the flight dates on the order when
// the desk set them, else the span of the placement dates publishers booked.
async function scheduledWindow(orderId: string): Promise<{ start: Date | null; end: Date | null }> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      flightStartDate: true,
      flightEndDate: true,
      lines: { select: { booking: { select: { placementDate: true } } } },
    },
  });
  if (order.flightStartDate) {
    return { start: order.flightStartDate, end: order.flightEndDate };
  }
  const dates = order.lines
    .map((l) => l.booking?.placementDate?.getTime())
    .filter((t): t is number => typeof t === "number");
  if (dates.length === 0) return { start: null, end: null };
  return { start: new Date(Math.min(...dates)), end: new Date(Math.max(...dates)) };
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
    // The page explains why (cancelBlockKey) next to the banner.
    redirect(`/${locale}/desk/orders/${orderId}?cancel=blocked`);
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
    // Nothing of an instant order left live: its plan may be ordered again.
    releaseInstantOrderList(prisma, order.id),
  ]);

  await recordAudit(userId, "order.cancel", `Order:${order.id}`, {
    from: order.status,
    reason,
    actor,
  });

  const { planName, orgName } = await orderNoticeContext(order.id);
  await notifyOrg(order.organizationId, {
    kind: "ORDER_CANCELLED",
    template: { key: "orderCancelled", params: { planName, orderId: order.id, reason } },
  });
  // Notify each distinct publisher whose title was on the order so
  // their portal stops showing the booking as in-flight.
  await Promise.all(
    publisherIds.map((pid) =>
      notifyPublisher(pid, {
        kind: "ORDER_CANCELLED",
        template: { key: "publisherOrderCancelled", params: { orgName, reason } },
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
      select: { id: true, type: true, title: { select: { name: true } } },
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
          template: {
            key: "placementProposed",
            params: { titleName: product.title.name, productType: product.type, requestId },
          },
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
    const title = await prisma.title.findUnique({ where: { id: item.titleId }, select: { name: true } });
    await prisma.planItem.deleteMany({ where: { id: planItemId } });
    await recordAudit(userId, "plan.removeTitle", `PlanItem:${planItemId}`, { requestId });
    const req = await prisma.request.findUnique({
      where: { id: requestId },
      select: { organizationId: true },
    });
    if (req) {
      await notifyOrg(req.organizationId, {
        kind: "PLACEMENT_PROPOSED",
        template: {
          key: "placeholderRemoved",
          params: { titleName: title?.name ?? "", requestId },
        },
      });
    }
  }
  revalidatePath(`/${locale}/desk/${requestId}`);
  redirect(`/${locale}/desk/${requestId}`);
}
