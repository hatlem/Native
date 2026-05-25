"use server";

import { redirect } from "next/navigation";
import { OrderStatus, ContentAssetStatus, BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg, notifyPublisher } from "@/lib/notify";
import { enqueue } from "@/lib/jobs";
import { runSpecCheckForAsset, registerSpecCheckJob } from "@/lib/spec-check-runner";
import {
  canCancelOrder,
  cancelBlockReason,
  normaliseReason,
  type CancelActor,
} from "@/lib/cancellation";

registerSpecCheckJob();

const ORDER_FLOW: OrderStatus[] = [
  "CONFIRMED",
  "IN_PRODUCTION",
  "SCHEDULED",
  "LIVE",
  "COMPLETED",
];

const ASSET_TARGETS: ContentAssetStatus[] = [
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "FINAL",
];

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requireDesk(locale: string): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  return session.user.id;
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

export async function saveDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderLineId = field(formData, "orderLineId");
  const orderId = field(formData, "orderId");
  const body = field(formData, "body");
  const userId = await requireDesk(locale);

  const brief = await prisma.contentBrief.findUnique({
    where: { orderLineId },
    include: { assets: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (brief && body) {
    const nextVersion = (brief.assets[0]?.version ?? 0) + 1;
    const asset = await prisma.contentAsset.create({
      data: {
        briefId: brief.id,
        version: nextVersion,
        status: "DRAFT",
        body,
      },
    });
    await recordAudit(userId, "asset.draft", `ContentAsset:${asset.id}`, {
      version: nextVersion,
    });
    // Queue spec check rather than block the form submission.
    await enqueue("spec.check", { assetId: asset.id });
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function runSpecCheck(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const userId = await requireDesk(locale);

  await runSpecCheckForAsset(assetId);
  await recordAudit(userId, "asset.spec_check", `ContentAsset:${assetId}`);

  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function setAssetStatus(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const target = field(formData, "target") as ContentAssetStatus;
  const userId = await requireDesk(locale);

  if (ASSET_TARGETS.includes(target)) {
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      include: { brief: { select: { orderLine: { select: { orderId: true, id: true } } } } },
    });
    // FINAL requires a passing spec check.
    if (asset && !(target === "FINAL" && asset.specPassed !== true)) {
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: { status: target },
      });
      await recordAudit(userId, "asset.status", `ContentAsset:${asset.id}`, {
        status: target,
      });
      // The buyer cares about review/approval transitions — notify them.
      const order = await prisma.order.findUnique({
        where: { id: asset.brief.orderLine.orderId },
        select: { organizationId: true },
      });
      if (order && (target === "IN_REVIEW" || target === "CHANGES_REQUESTED")) {
        await notifyOrg(order.organizationId, {
          kind: "ASSET_REVIEW",
          title:
            target === "IN_REVIEW"
              ? "Content draft ready for review"
              : "Content changes requested",
          link: `/${locale}/orders/${asset.brief.orderLine.orderId}`,
        });
      }
    }
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
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
    where: { id: { in: order.lines.map((l) => l.productId) } },
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
        title: "Order cancelled by ATNative desk",
        body: reason,
        link: `/${locale}/publisher/orders`,
      }),
    ),
  );

  redirect(`/${locale}/desk/orders/${order.id}`);
}

export async function issueInvoice(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const userId = await requireDesk(locale);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { quote: { include: { lines: true } }, invoices: true, lines: true },
  });

  if (order && order.invoices.length === 0) {
    const q = order.quote;
    const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [invoice] = await prisma.$transaction([
      prisma.invoice.create({
        data: {
          organizationId: order.organizationId,
          orderId: order.id,
          status: "ISSUED",
          currency: q.currency,
          subtotal: q.subtotal,
          vatPct: q.vatPct,
          total: q.total,
          issuedAt: new Date(),
          dueAt,
          lines: {
            create: q.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitAmount: l.lineTotal,
              lineTotal: l.lineTotal,
            })),
          },
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: { status: "INVOICED" },
      }),
    ]);
    await recordAudit(userId, "invoice.issue", `Invoice:${invoice.id}`, {
      orderId: order.id,
      total: Number(q.total),
      currency: q.currency,
    });
    await notifyOrg(order.organizationId, {
      kind: "INVOICE_ISSUED",
      title: "Invoice issued",
      body: `Total ${Number(q.total)} ${q.currency}, due ${dueAt.toISOString().slice(0, 10)}.`,
      link: `/${locale}/invoices/${invoice.id}`,
    });
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}

