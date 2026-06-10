"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { OrderStatus, BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg, notifyPublisher } from "@/lib/notify";
import { requireDesk } from "@/lib/desk-guard";
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
      await notifyOrg(order.organizationId, {
        kind: "ASSET_REVIEW",
        title: `Order ${next.toLowerCase().replace(/_/g, " ")}`,
        link: `/${locale}/orders/${order.id}`,
      });
    }
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
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
