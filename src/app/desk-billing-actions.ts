"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyOrg, notifyPublisher } from "@/lib/notify";
import { requireDesk } from "@/lib/desk-guard";
import { normaliseReason, type CancelActor } from "@/lib/cancellation";
import { issueFullCreditNote, issueInvoiceForOrder } from "@/lib/billing";
import { syncCreditNoteToAccounting, syncInvoiceToAccounting } from "@/lib/accounting-sync";
import { orderNoticeContext } from "@/lib/notice-context";

// Desk billing: issue the invoice for a completed order, credit it in full,
// and retry an accounting push that failed. The DB rules live in
// lib/billing.ts (compare-and-set, testable); this file adds the session
// guard, notifications, the accounting push and the redirect.
//
// Lifecycle (lib/order-lifecycle.ts):
//   COMPLETED ──issueInvoice──→ INVOICED ──issueCreditNote──→ CANCELLED
//
// Accounting: the push runs after the local write and never blocks it. Its
// outcome is stored on the invoice / credit note and shown on the desk
// order page, with a retry when it failed.

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function orderPath(locale: string, orderId: string): string {
  return `/${locale}/desk/orders/${orderId}`;
}

export async function issueInvoice(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const userId = await requireDesk(locale);

  const result = await issueInvoiceForOrder({ orderId, actorId: userId });
  if (result.ok) {
    await syncInvoiceToAccounting(result.invoiceId, { actorId: userId });
    const { organizationId, planName } = await orderNoticeContext(orderId);
    await notifyOrg(organizationId, {
      kind: "INVOICE_ISSUED",
      template: {
        key: "invoiceIssued",
        params: {
          planName,
          invoiceId: result.invoiceId,
          total: result.total,
          currency: result.currency,
          dueAt: result.dueAt.toISOString(),
        },
      },
    });
    revalidatePath(orderPath(locale, orderId));
  }
  // A refused issue (already invoiced / not completed) lands back on the
  // order, whose header shows the current state and what's possible.
  redirect(orderPath(locale, orderId));
}

// Full credit note against the order's issued invoice: the invoice becomes
// CREDITED, the order ends CANCELLED, the buyer (and any publisher with a
// placement that hadn't run) is told why.
export async function issueCreditNote(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const reason = normaliseReason(field(formData, "reason"));
  const userId = await requireDesk(locale);

  if (!reason) redirect(`${orderPath(locale, orderId)}?credit=reason-required`);

  const session = await auth();
  const actorRole: CancelActor = session?.user?.role === "SUPERADMIN" ? "SUPERADMIN" : "DESK";
  const result = await issueFullCreditNote({ orderId, actorId: userId, actorRole, reason });
  if (!result.ok) redirect(`${orderPath(locale, orderId)}?credit=${result.reason}`);

  await syncCreditNoteToAccounting(result.creditNoteId, { actorId: userId });

  const { organizationId, orgName, planName } = await orderNoticeContext(orderId);
  await notifyOrg(organizationId, {
    kind: "INVOICE_ISSUED",
    template: {
      key: "creditNoteIssued",
      params: {
        planName,
        invoiceId: result.invoiceId,
        amount: result.amount,
        currency: result.currency,
        reason,
      },
    },
  });
  await Promise.all(
    result.publisherIds.map((pid) =>
      notifyPublisher(pid, {
        kind: "ORDER_CANCELLED",
        template: { key: "publisherOrderCancelled", params: { orgName, reason } },
      }),
    ),
  );

  revalidatePath(orderPath(locale, orderId));
  redirect(orderPath(locale, orderId));
}

// Re-run the accounting push for an invoice or credit note whose last push
// failed (or never ran). Already-synced documents are left alone by the
// sync itself, so this can't create duplicates in the ledger.
export async function retryAccountingSync(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const invoiceId = field(formData, "invoiceId");
  const creditNoteId = field(formData, "creditNoteId");
  const userId = await requireDesk(locale);

  // Only documents belonging to the order on screen — the ids round-trip
  // through the browser.
  if (invoiceId) {
    const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, orderId }, select: { id: true } });
    if (inv) await syncInvoiceToAccounting(inv.id, { actorId: userId });
  }
  if (creditNoteId) {
    const note = await prisma.creditNote.findFirst({
      where: { id: creditNoteId, orderId },
      select: { id: true },
    });
    if (note) await syncCreditNoteToAccounting(note.id, { actorId: userId });
  }
  revalidatePath(orderPath(locale, orderId));
  redirect(orderPath(locale, orderId));
}
