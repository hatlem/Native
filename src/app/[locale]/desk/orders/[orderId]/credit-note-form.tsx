import { getTranslations } from "next-intl/server";
import type { Invoice } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { issueCreditNote } from "@/app/desk-billing-actions";
import { SubmitButton } from "@/components";

// Full credit note against the order's issued invoice. Rendered only when
// order-lifecycle.ts creditNoteEligibility says one can be issued, so the
// control and the server rule can't disagree.
export async function CreditNoteForm({
  locale,
  orderId,
  invoice,
}: {
  locale: string;
  orderId: string;
  invoice: Invoice;
}) {
  const t = await getTranslations({ locale, namespace: "order" });
  return (
    <details className="spec-details">
      <summary>
        <span className="btn secondary block">{t("creditNoteButton")}</span>
      </summary>
      <form action={issueCreditNote} className="product-form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="orderId" value={orderId} />
        <h4 style={{ margin: "12px 0 4px" }}>{t("creditNoteTitle")}</h4>
        <p className="muted small">
          {t("creditNoteHint", {
            amount: formatMoney(Number(invoice.total), invoice.currency, locale),
          })}
        </p>
        <div className="field">
          <label htmlFor={`credit-reason-${orderId}`}>{t("creditNoteReasonLabel")}</label>
          <textarea
            id={`credit-reason-${orderId}`}
            name="reason"
            rows={3}
            required
            placeholder={t("creditNoteReasonPlaceholder")}
          />
        </div>
        <div className="actions">
          <SubmitButton
            label={t("creditNoteSubmit")}
            pendingLabel={t("issuingCreditNote")}
            className="btn block"
          />
        </div>
      </form>
    </details>
  );
}
