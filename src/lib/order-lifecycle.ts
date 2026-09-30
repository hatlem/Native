// Pure order/invoice lifecycle rules. The server actions (desk-actions.ts,
// desk-billing-actions.ts) and the desk order page both read these, so the
// buttons the desk sees and the transitions the server accepts can't drift
// apart. No DB access here — unit-tested in order-lifecycle.test.ts.
//
// The lifecycle, end to end:
//
//   CONFIRMED → IN_PRODUCTION → SCHEDULED → LIVE → COMPLETED   (advanceOrder)
//        │            │             │
//        └────────────┴─────────────┴──→ CANCELLED            (cancelOrder)
//
//   COMPLETED ──issueInvoice──→ INVOICED ──full credit note──→ CANCELLED
//
// Before an invoice exists the order is simply cancelled; once one exists,
// the only correct reversal is a credit note (never voiding the invoice,
// which would lose the "what was billed" record). A full credit note
// refunds the whole invoice, so nothing is owed any more and the order ends
// CANCELLED — the same terminal state as a pre-invoice cancellation, with
// the credit note as the paper trail.

import { OrderStatus, type BookingStatus, type InvoiceStatus } from "@prisma/client";

export const ORDER_FLOW: readonly OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.SCHEDULED,
  OrderStatus.LIVE,
  OrderStatus.COMPLETED,
];

// The status "Advance" moves to, or null when the order is not on the
// production flow any more (COMPLETED, INVOICED, CANCELLED, QUOTED).
export function nextOrderStatus(status: OrderStatus): OrderStatus | null {
  const idx = ORDER_FLOW.indexOf(status);
  if (idx < 0 || idx >= ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[idx + 1];
}

// ---------- Invoicing ----------

type InvoiceLike = { id: string; status: InvoiceStatus };
type CreditNoteLike = { invoiceId: string };

// Invoices that still bill the customer. A CREDITED or VOID invoice no
// longer counts as "the order's invoice".
const OPEN_INVOICE_STATUSES: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>([
  "DRAFT",
  "ISSUED",
  "PAID",
  "OVERDUE",
]);

// Only an issued invoice can be credited: a DRAFT was never sent, and a
// CREDITED/VOID one has nothing left to refund.
const CREDITABLE_INVOICE_STATUSES: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>([
  "ISSUED",
  "PAID",
  "OVERDUE",
]);

// The desk bills a finished campaign exactly once.
export function canIssueInvoice(
  status: OrderStatus,
  invoices: readonly InvoiceLike[],
): boolean {
  return (
    status === OrderStatus.COMPLETED &&
    !invoices.some((i) => OPEN_INVOICE_STATUSES.has(i.status))
  );
}

// ---------- Extra work (billed hours after acceptance) ----------

// Extra work agreed after the quote was accepted goes onto the order's
// invoice when it is issued (lib/billing.ts). So it can be added, or removed
// again, from confirmation until that invoice exists: never on a cancelled
// order, and never after invoicing (the invoice is the "what was billed"
// record; a later correction is a credit note, not a new line).
const EXTRA_WORK_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  ...ORDER_FLOW,
]);

export type ExtraWorkBlock = "invoiced" | "closed";

export function extraWorkBlock(
  status: OrderStatus,
  invoices: readonly InvoiceLike[],
): ExtraWorkBlock | null {
  if (status === OrderStatus.INVOICED || invoices.some((i) => OPEN_INVOICE_STATUSES.has(i.status))) {
    return "invoiced";
  }
  return EXTRA_WORK_ORDER_STATUSES.has(status) ? null : "closed";
}

/** Order statuses extra work may be written against (the DB-side guard). */
export const EXTRA_WORK_ORDER_STATUS_LIST: OrderStatus[] = [...EXTRA_WORK_ORDER_STATUSES];

export type CreditNoteBlock =
  | "no-invoice"
  | "already-credited"
  | "wrong-order-status";

export type CreditNoteEligibility<I extends InvoiceLike> =
  | { ok: true; invoice: I }
  | { ok: false; reason: CreditNoteBlock };

// Which invoice a full credit note would refund, or why none can be issued.
// INVOICED is the normal case. CANCELLED is accepted too so an order that
// reached CANCELLED with an invoice still open (legacy data, or a future
// path) can still be put right rather than stranded.
export function creditNoteEligibility<I extends InvoiceLike>(
  status: OrderStatus,
  invoices: readonly I[],
  creditNotes: readonly CreditNoteLike[],
): CreditNoteEligibility<I> {
  if (status !== OrderStatus.INVOICED && status !== OrderStatus.CANCELLED) {
    return { ok: false, reason: "wrong-order-status" };
  }
  const invoice = invoices.find((i) => CREDITABLE_INVOICE_STATUSES.has(i.status));
  if (!invoice) {
    return {
      ok: false,
      reason: creditNotes.length > 0 ? "already-credited" : "no-invoice",
    };
  }
  if (creditNotes.some((c) => c.invoiceId === invoice.id)) {
    return { ok: false, reason: "already-credited" };
  }
  return { ok: true, invoice };
}

// A full credit note leaves nothing owed, so the deal is off.
export const ORDER_STATUS_AFTER_FULL_CREDIT: OrderStatus = OrderStatus.CANCELLED;

// ---------- Delivery evidence (advancing to LIVE / COMPLETED) ----------

// Statuses that tell the buyer something ran. Advancing into one of these
// without evidence would email the buyer a claim nobody has verified.
export const DELIVERY_GATED_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  OrderStatus.LIVE,
  OrderStatus.COMPLETED,
]);

export type DeliveryLine = {
  id: string;
  kind: "INVENTORY" | "CONTENT_FEE" | "EXTRA_WORK";
  label: string;
  booking: { status: BookingStatus; liveUrl: string | null } | null;
};

export type DeliveryGap = {
  // True when advancing needs the desk's explicit confirmation.
  needsConfirmation: boolean;
  // Placements with a published link / publisher-reported publication.
  published: DeliveryLine[];
  // Placements with neither.
  missing: DeliveryLine[];
  // Placements that count (cancelled bookings are excluded).
  total: number;
};

// A placement counts as delivered when the publisher reported it PUBLISHED
// or a published link is on the booking. A CONFIRMED booking only means the
// publisher accepted it — not that it ran.
export function isPlacementPublished(line: DeliveryLine): boolean {
  if (!line.booking) return false;
  return line.booking.status === "PUBLISHED" || Boolean(line.booking.liveUrl?.trim());
}

// Content-fee lines have no placement to publish (the article ships on its
// placement), and a cancelled booking is no longer expected to run.
export function deliveryGap(
  lines: readonly DeliveryLine[],
  next: OrderStatus | null,
): DeliveryGap {
  const placements = lines.filter(
    (l) => l.kind === "INVENTORY" && l.booking?.status !== "CANCELLED",
  );
  const published = placements.filter(isPlacementPublished);
  const missing = placements.filter((l) => !isPlacementPublished(l));
  return {
    needsConfirmation:
      next !== null && DELIVERY_GATED_STATUSES.has(next) && missing.length > 0,
    published,
    missing,
    total: placements.length,
  };
}
