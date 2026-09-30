// Push an issued invoice / credit note to the accounting provider and
// record the outcome on the row.
//
// Rules:
//   - Runs AFTER the local document is committed. Issuing is never blocked
//     by the provider: a NativeSpin invoice exists whether or not the ledger
//     push worked.
//   - No provider configured → the noop provider logs, and the row records
//     provider "noop" (kept local on purpose, visible to the desk).
//   - A failed push is never swallowed: the error is stored on the row,
//     audited, and the desk order page shows it with a retry.
//   - Already synced (external ref stored) → no second push, so a retry or
//     a double click can't create a duplicate in the ledger.
//
// The provider is injectable so tests never reach the real Fiken API.

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  buildAccountingInvoice,
  getAccountingProvider,
  type AccountingProvider,
  type PushResult,
} from "@/lib/accounting";

export type SyncOutcome =
  | { status: "synced"; provider: string; externalRef: string | null; externalNumber: string | null }
  | { status: "local-only"; provider: string }
  | { status: "failed"; provider: string; error: string };

// Stored errors are shown in the desk UI; keep them readable.
const MAX_ERROR_CHARS = 500;

function outcomeFrom(result: PushResult, provider: AccountingProvider): SyncOutcome {
  if (!result.ok) {
    return { status: "failed", provider: result.provider, error: result.error.slice(0, MAX_ERROR_CHARS) };
  }
  if (!provider.live) return { status: "local-only", provider: result.provider };
  return {
    status: "synced",
    provider: result.provider,
    externalRef: result.externalRef,
    externalNumber: result.externalNumber ?? null,
  };
}

function syncFields(outcome: SyncOutcome, now: Date) {
  switch (outcome.status) {
    case "synced":
      return {
        accountingProvider: outcome.provider,
        accountingRef: outcome.externalRef,
        accountingNumber: outcome.externalNumber,
        accountingSyncedAt: now,
        accountingError: null,
      };
    case "local-only":
      return { accountingProvider: outcome.provider, accountingError: null };
    case "failed":
      return { accountingProvider: outcome.provider, accountingError: outcome.error };
  }
}

// A provider that throws (a bug, not a reported failure) is still a
// failure the desk must see, not a 500 after the invoice was issued.
async function safePush(
  provider: AccountingProvider,
  push: () => Promise<PushResult>,
): Promise<PushResult> {
  try {
    return await push();
  } catch (err) {
    return {
      ok: false,
      provider: provider.name,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function syncInvoiceToAccounting(
  invoiceId: string,
  opts: { provider?: AccountingProvider; actorId?: string | null; now?: Date } = {},
): Promise<SyncOutcome> {
  const provider = opts.provider ?? getAccountingProvider();
  const now = opts.now ?? new Date();
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lines: true, organization: { select: { id: true, name: true, vatId: true } } },
  });
  if (invoice.accountingRef) {
    return {
      status: "synced",
      provider: invoice.accountingProvider ?? provider.name,
      externalRef: invoice.accountingRef,
      externalNumber: invoice.accountingNumber,
    };
  }

  const doc = buildAccountingInvoice(invoice, invoice.organization);
  const outcome = outcomeFrom(await safePush(provider, () => provider.pushInvoice(doc)), provider);
  await prisma.invoice.update({ where: { id: invoice.id }, data: syncFields(outcome, now) });
  await recordAudit(opts.actorId ?? null, "invoice.accounting_sync", `Invoice:${invoice.id}`, outcome);
  if (outcome.status === "failed") {
    console.error("accounting.push_failed", { invoiceId: invoice.id, ...outcome });
  }
  return outcome;
}

export async function syncCreditNoteToAccounting(
  creditNoteId: string,
  opts: { provider?: AccountingProvider; actorId?: string | null; now?: Date } = {},
): Promise<SyncOutcome> {
  const provider = opts.provider ?? getAccountingProvider();
  const now = opts.now ?? new Date();
  const note = await prisma.creditNote.findUniqueOrThrow({
    where: { id: creditNoteId },
    include: { invoice: { select: { id: true, accountingRef: true } } },
  });
  if (note.accountingRef) {
    return {
      status: "synced",
      provider: note.accountingProvider ?? provider.name,
      externalRef: note.accountingRef,
      externalNumber: note.accountingNumber,
    };
  }

  const outcome = outcomeFrom(
    await safePush(provider, () =>
      provider.pushCreditNote({
        creditNoteId: note.id,
        invoiceId: note.invoiceId,
        invoiceExternalRef: note.invoice.accountingRef,
        issuedAt: note.issuedAt.toISOString(),
        currency: note.currency,
        amount: Number(note.amount),
        reason: note.reason,
      }),
    ),
    provider,
  );
  await prisma.creditNote.update({ where: { id: note.id }, data: syncFields(outcome, now) });
  await recordAudit(opts.actorId ?? null, "credit_note.accounting_sync", `CreditNote:${note.id}`, outcome);
  if (outcome.status === "failed") {
    console.error("accounting.push_failed", { creditNoteId: note.id, ...outcome });
  }
  return outcome;
}
