"use server";

import { redirect } from "next/navigation";
import { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg } from "@/lib/notify";
import { requireDesk } from "@/lib/desk-guard";
import { normaliseReason } from "@/lib/cancellation";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
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
