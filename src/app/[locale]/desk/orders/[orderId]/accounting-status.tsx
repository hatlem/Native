import { getTranslations } from "next-intl/server";
import type { CreditNote, Invoice } from "@prisma/client";
import { retryAccountingSync } from "@/app/desk-billing-actions";
import { SubmitButton } from "@/components";

type SyncState = {
  accountingProvider: string | null;
  accountingRef: string | null;
  accountingNumber: string | null;
  accountingError: string | null;
};

type Props = {
  locale: string;
  orderId: string;
  invoice: Invoice | undefined;
  creditNotes: CreditNote[];
};

const PROVIDER_NAMES: Readonly<Record<string, string>> = { fiken: "Fiken" };

function providerName(p: string | null): string {
  return p ? (PROVIDER_NAMES[p] ?? p) : "";
}

// Where each billing document stands in the accounting system. A failed
// push is an error banner with a retry — the desk must see it, since an
// invoice missing from the ledger is otherwise invisible until month-end.
export async function AccountingStatus({ locale, orderId, invoice, creditNotes }: Props) {
  if (!invoice) return null;
  const t = await getTranslations({ locale, namespace: "order" });
  const note = creditNotes.find((c) => c.invoiceId === invoice.id);

  const rows: { key: string; doc: string; state: SyncState; idField: "invoiceId" | "creditNoteId"; id: string }[] = [
    { key: invoice.id, doc: t("accountingDocInvoice"), state: invoice, idField: "invoiceId", id: invoice.id },
    ...(note
      ? [{ key: note.id, doc: t("accountingDocCreditNote"), state: note, idField: "creditNoteId" as const, id: note.id }]
      : []),
  ];

  return (
    <>
      {rows.map(({ key, doc, state, idField, id }) => {
        const provider = providerName(state.accountingProvider);
        if (state.accountingError) {
          return (
            <div key={key} className="banner-error" role="alert">
              <span>{t("accountingFailed", { doc, provider, error: state.accountingError })}</span>{" "}
              <form action={retryAccountingSync} style={{ display: "inline" }}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="orderId" value={orderId} />
                <input type="hidden" name={idField} value={id} />
                <SubmitButton
                  label={t("accountingRetry")}
                  pendingLabel={t("accountingRetrying")}
                  className="btn small secondary"
                />
              </form>
            </div>
          );
        }
        const message = state.accountingRef
          ? state.accountingNumber
            ? t("accountingSynced", { doc, provider, number: state.accountingNumber })
            : t("accountingSyncedNoNumber", { doc, provider })
          : state.accountingProvider === "noop"
            ? t("accountingLocalOnly", { doc })
            : t("accountingNotSent", { doc });
        return (
          <p key={key} className="muted small" role="status">
            {message}
          </p>
        );
      })}
    </>
  );
}
