// Invoice and credit-note issuing: the DB half of desk-billing-actions.ts.
// Kept out of the "use server" file so integration tests can drive it
// without a session or a redirect, and so the state rules it enforces are
// the same pure ones the desk UI renders from (order-lifecycle.ts).
//
// Both writes are compare-and-set: the status the rule was checked against
// is re-asserted inside the transaction, so a double-submitted form (or two
// desk tabs) can never mint two invoices or two credit notes.

import { OrderStatus, type ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { releaseInstantOrderList } from "@/lib/commerce/list-commit";
import { recordAudit } from "@/lib/audit";
import { invoiceDueAt, paymentTermsDaysFor } from "@/lib/payment-terms";
import { lineOrder } from "@/lib/commerce/line-order";
import {
  ORDER_STATUS_AFTER_FULL_CREDIT,
  canIssueInvoice,
  creditNoteEligibility,
  type CreditNoteBlock,
} from "@/lib/order-lifecycle";

// Same description convention as money.ts computeContentFeeLines — the only
// link between a CONTENT_FEE line and the placement it was priced for.
const CONTENT_FEE_PREFIX = "Content production — ";

export type IssueInvoiceResult =
  | { ok: true; invoiceId: string; total: number; currency: string; dueAt: Date }
  | { ok: false; reason: "not-found" | "not-invoiceable" };

export async function issueInvoiceForOrder(args: {
  orderId: string;
  actorId: string;
  now?: Date;
}): Promise<IssueInvoiceResult> {
  const now = args.now ?? new Date();
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    include: {
      quote: { include: { lines: { orderBy: lineOrder() } } },
      invoices: true,
      organization: { select: { paymentTermsDays: true } },
    },
  });
  if (!order) return { ok: false, reason: "not-found" };
  if (!canIssueInvoice(order.status, order.invoices)) {
    return { ok: false, reason: "not-invoiceable" };
  }

  const q = order.quote;
  // "Price on request" lines were never agreed or accepted (accept-quote
  // accepts the priced lines only) and are already outside quote.subtotal,
  // so billing them would make the lines disagree with the total.
  const billable = q.lines.filter((l) => !l.priceOnRequest);
  const products = await prisma.product.findMany({
    where: { id: { in: billable.map((l) => l.productId).filter((id): id is string => !!id) } },
    select: { id: true, name: true, type: true, title: { select: { name: true } } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  const productByName = new Map(products.map((p) => [p.name, p]));

  // The customer's agreed terms, snapshotted onto the invoice with the due
  // date they produce.
  const paymentTermsDays = paymentTermsDaysFor(order.organization);
  const dueAt = invoiceDueAt(now, paymentTermsDays);
  const lines = billable.map((l) => {
    const product =
      l.kind === "CONTENT_FEE"
        ? productByName.get(l.description.replace(CONTENT_FEE_PREFIX, ""))
        : l.productId
          ? productById.get(l.productId)
          : undefined;
    const lineTotal = Number(l.lineTotal);
    return {
      description: l.description,
      kind: l.kind,
      productId: product?.id ?? null,
      titleName: product?.title.name ?? null,
      productType: (product?.type ?? null) as ProductType | null,
      quantity: l.quantity,
      // Per-unit amount, not the line total (the two differ whenever a
      // placement runs more than once).
      unitAmount: l.quantity > 0 ? Math.round((lineTotal / l.quantity) * 100) / 100 : lineTotal,
      lineTotal,
      // Invoice lines keep the quote's display order (line-order.ts).
      position: l.position,
    };
  });

  const invoice = await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: OrderStatus.COMPLETED },
      data: { status: OrderStatus.INVOICED },
    });
    if (claimed.count !== 1) return null;
    return tx.invoice.create({
      data: {
        organizationId: order.organizationId,
        orderId: order.id,
        status: "ISSUED",
        currency: q.currency,
        subtotal: q.subtotal,
        vatPct: q.vatPct,
        total: q.total,
        issuedAt: now,
        dueAt,
        paymentTermsDays,
        lines: { create: lines },
      },
    });
  });
  if (!invoice) return { ok: false, reason: "not-invoiceable" };

  await recordAudit(args.actorId, "invoice.issue", `Invoice:${invoice.id}`, {
    orderId: order.id,
    total: Number(q.total),
    currency: q.currency,
    paymentTermsDays,
  });
  return { ok: true, invoiceId: invoice.id, total: Number(q.total), currency: q.currency, dueAt };
}

export type IssueCreditNoteResult =
  | {
      ok: true;
      creditNoteId: string;
      invoiceId: string;
      amount: number;
      currency: string;
      publisherIds: string[];
    }
  | { ok: false; reason: "not-found" | CreditNoteBlock };

// Full credit note: refunds the whole invoice, marks it CREDITED and ends
// the order CANCELLED (nothing is owed any more). Placements that have not
// run are cancelled on the publisher side exactly as cancelOrder does;
// published ones are history and stay as they are.
export async function issueFullCreditNote(args: {
  orderId: string;
  actorId: string;
  actorRole: string;
  reason: string;
  now?: Date;
}): Promise<IssueCreditNoteResult> {
  const now = args.now ?? new Date();
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    include: { invoices: true, creditNotes: true, lines: { select: { id: true, productId: true } } },
  });
  if (!order) return { ok: false, reason: "not-found" };
  const eligibility = creditNoteEligibility(order.status, order.invoices, order.creditNotes);
  if (!eligibility.ok) return eligibility;
  const { invoice } = eligibility;

  const creditNote = await prisma.$transaction(async (tx) => {
    const claimed = await tx.invoice.updateMany({
      where: { id: invoice.id, status: { in: ["ISSUED", "PAID", "OVERDUE"] } },
      data: { status: "CREDITED" },
    });
    if (claimed.count !== 1) return null;
    const note = await tx.creditNote.create({
      data: {
        invoiceId: invoice.id,
        orderId: order.id,
        currency: invoice.currency,
        amount: invoice.total,
        reason: args.reason,
        issuedAt: now,
        issuedBy: args.actorId,
      },
    });
    if (order.status !== ORDER_STATUS_AFTER_FULL_CREDIT) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: ORDER_STATUS_AFTER_FULL_CREDIT,
          cancelledAt: now,
          cancelReason: args.reason,
          cancelledBy: args.actorRole,
        },
      });
    }
    await tx.publisherBooking.updateMany({
      where: {
        orderLineId: { in: order.lines.map((l) => l.id) },
        status: { notIn: ["PUBLISHED", "CONFIRMED", "CANCELLED"] },
      },
      data: { status: "CANCELLED" },
    });
    // Nothing of an instant order left live: its plan may be ordered again.
    await releaseInstantOrderList(tx, order.id);
    return note;
  });
  // The invoice CAS lost: a concurrent submit credited it first.
  if (!creditNote) return { ok: false, reason: "already-credited" };

  await recordAudit(args.actorId, "credit_note.issue", `Invoice:${invoice.id}`, {
    orderId: order.id,
    creditNoteId: creditNote.id,
    amount: Number(invoice.total),
    currency: invoice.currency,
    reason: args.reason,
    orderStatusFrom: order.status,
    orderStatusTo: ORDER_STATUS_AFTER_FULL_CREDIT,
  });

  const products = await prisma.product.findMany({
    where: { id: { in: order.lines.map((l) => l.productId).filter((id): id is string => !!id) } },
    select: { title: { select: { publisherId: true } } },
  });
  const publisherIds = [...new Set(products.map((p) => p.title.publisherId).filter((id): id is string => !!id))];

  return {
    ok: true,
    creditNoteId: creditNote.id,
    invoiceId: invoice.id,
    amount: Number(invoice.total),
    currency: invoice.currency,
    publisherIds,
  };
}
