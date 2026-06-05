"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { OrderStatus, ContentAssetStatus, BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg, notifyPublisher } from "@/lib/notify";
import { enqueue } from "@/lib/jobs";
import { runSpecCheckForAsset, registerSpecCheckJob } from "@/lib/spec-check-runner";
import { ensureTrackedLinks } from "@/lib/metrics/store";
import { rewriteBodyLinks } from "@/lib/metrics/links";
import {
  canCancelOrder,
  cancelBlockReason,
  normaliseReason,
  type CancelActor,
} from "@/lib/cancellation";
import { requireLineWriter } from "@/lib/writers/guard";

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

// Desk confirms which auto-detected outbound links in a produced article
// to track. Each chosen URL becomes a TrackedLink (idempotent) and the
// asset body is rewritten so the published article uses /go/<token>.
export async function confirmTrackedLinks(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const orderLineId = field(formData, "orderLineId");
  const assetId = field(formData, "assetId");
  const { userId } = await requireLineWriter(orderLineId, locale);

  const chosen = formData
    .getAll("trackUrl")
    .map((v) => String(v))
    .filter((url) => /^https?:\/\//.test(url))
    .map((url) => ({ url, label: null }));

  if (chosen.length) {
    const map = await ensureTrackedLinks(orderLineId, chosen);
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      select: { id: true, body: true },
    });
    if (asset?.body) {
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: { body: rewriteBodyLinks(asset.body, map) },
      });
    }
    await recordAudit(userId, "asset.track_links", `ContentAsset:${assetId}`, {
      count: chosen.length,
    });
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}

async function requireDesk(locale: string): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  return session.user.id;
}

// What status transitions the CONTENT role is allowed to invoke from
// setAssetStatus. CONTENT hands a draft to the desk for review; it
// never approves or finalises (those gates belong to the buyer + desk).
const CONTENT_ASSET_TARGETS: ReadonlySet<ContentAssetStatus> = new Set([
  ContentAssetStatus.IN_REVIEW,
]);

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
  // Optional: writer flags this as an adaptation of a previously
  // shipped asset. Persisted on ContentAsset.sourceAssetId so the
  // desk can charge adaptation-rate instead of greenfield and the
  // audit chain shows quote-reuse lineage (Maja R2's deeper gap).
  const sourceAssetId = field(formData, "sourceAssetId") || null;
  const { userId, writerProfileId, role } = await requireLineWriter(
    orderLineId,
    locale,
  );

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
        sourceAssetId: sourceAssetId || null,
        authorWriterId: writerProfileId,
      },
    });
    await recordAudit(userId, "asset.draft", `ContentAsset:${asset.id}`, {
      version: nextVersion,
      sourceAssetId: sourceAssetId || null,
    });
    // Queue spec check rather than block the form submission.
    await enqueue("spec.check", { assetId: asset.id });
  }
  // CONTENT writers return to their console; desk stays on the order page.
  redirect(
    role === "CONTENT"
      ? `/${locale}/writer/lines/${orderLineId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}

export async function runSpecCheck(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { brief: { select: { orderLineId: true } } },
  });
  const orderLineId = asset?.brief.orderLineId ?? "";
  const { userId, role } = await requireLineWriter(orderLineId, locale);

  await runSpecCheckForAsset(assetId);
  await recordAudit(userId, "asset.spec_check", `ContentAsset:${assetId}`);

  redirect(
    role === "CONTENT"
      ? `/${locale}/writer/lines/${orderLineId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}

export async function setAssetStatus(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const target = field(formData, "target") as ContentAssetStatus;
  const assetForLine = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { brief: { select: { orderLineId: true } } },
  });
  const orderLineId = assetForLine?.brief.orderLineId ?? "";
  const { userId, role } = await requireLineWriter(orderLineId, locale);

  // Writers can only hand a draft off for review. APPROVED / FINAL /
  // CHANGES_REQUESTED stay with the desk + buyer.
  if (role === "CONTENT" && !CONTENT_ASSET_TARGETS.has(target)) {
    redirect(`/${locale}/writer/lines/${orderLineId}`);
  }

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
  redirect(
    role === "CONTENT"
      ? `/${locale}/writer/lines/${orderLineId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
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

// Issue a credit note against the order's invoice. The supported v1
// shape is full-credit: we refund the invoice total, mark the invoice
// CREDITED, and record the reason. Partial credits are a real need
// (e.g. publisher refunds line A but the customer still pays for line
// B) but they introduce per-line accounting that wants its own design
// pass; v1 keeps the surface tight.
//
// Required preconditions:
//   - Order has a CANCELLED status (the typical credit-note trigger)
//   - Order has exactly one issued (or paid) invoice with status
//     ISSUED / PAID / OVERDUE — not DRAFT, not already CREDITED/VOID.
//
// Side effects:
//   - CreditNote row written
//   - Invoice.status → CREDITED
//   - Audit row records actor + reason + amount
//   - Buyer org notified
export async function issueCreditNote(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const reason = normaliseReason(field(formData, "reason"));
  const userId = await requireDesk(locale);

  if (!reason) {
    redirect(`/${locale}/desk/orders/${orderId}?credit=reason-required`);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { invoices: true, creditNotes: true },
  });
  if (!order) {
    redirect(`/${locale}/desk/orders/${orderId}?credit=not-found`);
  }
  if (order.status !== OrderStatus.CANCELLED) {
    redirect(
      `/${locale}/desk/orders/${orderId}?credit=only-cancelled-orders`,
    );
  }
  if (order.creditNotes.length > 0) {
    redirect(`/${locale}/desk/orders/${orderId}?credit=already-issued`);
  }
  const invoice = order.invoices.find((i) =>
    ["ISSUED", "PAID", "OVERDUE"].includes(i.status),
  );
  if (!invoice) {
    redirect(`/${locale}/desk/orders/${orderId}?credit=no-eligible-invoice`);
  }

  await prisma.$transaction([
    prisma.creditNote.create({
      data: {
        invoiceId: invoice.id,
        orderId: order.id,
        currency: invoice.currency,
        amount: invoice.total,
        reason,
        issuedBy: userId,
      },
    }),
    prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "CREDITED" },
    }),
  ]);

  await recordAudit(userId, "credit_note.issue", `Invoice:${invoice.id}`, {
    orderId: order.id,
    amount: Number(invoice.total),
    currency: invoice.currency,
    reason,
  });

  await notifyOrg(order.organizationId, {
    kind: "INVOICE_ISSUED",
    title: "Credit note issued",
    body: `${Number(invoice.total)} ${invoice.currency} credited — ${reason}`,
    link: `/${locale}/invoices/${invoice.id}`,
  });

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

