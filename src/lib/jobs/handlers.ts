// Every job kind the queue can run, registered in one place so any runner
// (the in-process worker, /api/cron/sweeps, an enqueue kick) can execute any
// job. The work itself is imported lazily: this file is loaded by the worker
// loop and must not drag the PDF renderer or mail templates into every caller.
import { registerJob, NonRetryableJobError } from "@/lib/jobs";

let registered = false;

export function registerJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerJob<{ placementId: string }>("spec.check", async ({ placementId }) => {
    const { runSpecCheckForPlacement } = await import("@/lib/spec-check-runner");
    await runSpecCheckForPlacement(placementId);
  });

  registerJob(
    "webhook.deliver",
    async (payload: import("@/lib/webhooks").WebhookJobPayload, ctx) => {
      const { runWebhookDeliveryJob } = await import("@/lib/webhooks");
      await runWebhookDeliveryJob(payload, ctx);
    },
    { maxAttempts: 8, backoffBaseMs: 60_000 },
  );

  // A notice email whose first send failed (lib/notify.ts queues it).
  registerJob(
    "email.send",
    async (msg: import("@/lib/notify").EmailMessage) => {
      const { sendEmailNow } = await import("@/lib/notify");
      await sendEmailNow(msg);
    },
    { maxAttempts: 6, backoffBaseMs: 60_000 },
  );

  // Keep the issued invoice PDF in object storage (lib/invoice-archive.ts).
  registerJob<{ invoiceId: string }>("invoice.archive", async ({ invoiceId }) => {
    const { archiveInvoicePdfOrThrow } = await import("@/lib/invoice-archive");
    await archiveInvoicePdfOrThrow(invoiceId);
  });

  // Re-push an invoice / credit note the accounting provider refused.
  registerJob<{ invoiceId: string }>(
    "accounting.sync-invoice",
    async ({ invoiceId }) => {
      const { syncInvoiceToAccounting } = await import("@/lib/accounting-sync");
      const { prisma } = await import("@/lib/prisma");
      if (!(await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } }))) {
        throw new NonRetryableJobError("invoice no longer exists");
      }
      const outcome = await syncInvoiceToAccounting(invoiceId, { actorId: null, fromQueue: true });
      if (outcome.status === "failed") throw new Error(outcome.error);
    },
    { maxAttempts: 6, backoffBaseMs: 5 * 60_000 },
  );
  registerJob<{ creditNoteId: string }>(
    "accounting.sync-credit-note",
    async ({ creditNoteId }) => {
      const { syncCreditNoteToAccounting } = await import("@/lib/accounting-sync");
      const { prisma } = await import("@/lib/prisma");
      if (!(await prisma.creditNote.findUnique({ where: { id: creditNoteId }, select: { id: true } }))) {
        throw new NonRetryableJobError("credit note no longer exists");
      }
      const outcome = await syncCreditNoteToAccounting(creditNoteId, { actorId: null, fromQueue: true });
      if (outcome.status === "failed") throw new Error(outcome.error);
    },
    { maxAttempts: 6, backoffBaseMs: 5 * 60_000 },
  );
}
