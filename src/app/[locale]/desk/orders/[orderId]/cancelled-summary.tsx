import { getTranslations } from "next-intl/server";
import type { Invoice, Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { issueCreditNote } from "@/app/desk-billing-actions";
import { SubmitButton } from "@/components";

type OrderForCancelledSummary = Prisma.OrderGetPayload<{
  include: { creditNotes: true };
}>;

type Props = {
  locale: string;
  order: OrderForCancelledSummary;
  invoice: Invoice | undefined;
};

export async function CancelledSummary({ locale, order, invoice }: Props) {
  if (!(order.status === "CANCELLED" && order.cancelledAt)) return null;
  const t = await getTranslations({ locale, namespace: "order" });

  return (
    <section className="cancelled-summary">
      <h2>{t("cancelledAtLabel")}</h2>
      <dl className="spec-grid">
        <dt>{t("cancelledAtLabel")}</dt>
        <dd>{order.cancelledAt.toISOString().slice(0, 16).replace("T", " ")}</dd>
        {order.cancelledBy ? (
          <>
            <dt>{t("cancelledByLabel")}</dt>
            <dd>{order.cancelledBy}</dd>
          </>
        ) : null}
        {order.cancelReason ? (
          <>
            <dt>{t("cancelledReasonLabel")}</dt>
            <dd>{order.cancelReason}</dd>
          </>
        ) : null}
      </dl>

      {/* Credit-note affordance — only renders once invoice exists,
          order is CANCELLED, and no credit note has been issued. */}
      {invoice &&
      ["ISSUED", "PAID", "OVERDUE"].includes(invoice.status) &&
      order.creditNotes.length === 0 ? (
        <details className="spec-details">
          <summary>
            <span className="btn secondary">{t("creditNoteButton")}</span>
          </summary>
          <form action={issueCreditNote} className="product-form">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={order.id} />
            <h4 style={{ margin: "12px 0 4px" }}>{t("creditNoteTitle")}</h4>
            <p className="muted small">
              {t("creditNoteHint", {
                amount: formatMoney(
                  Number(invoice.total),
                  invoice.currency,
                  locale,
                ),
              })}
            </p>
            <div className="field">
              <label htmlFor={`credit-reason-${order.id}`}>
                {t("creditNoteReasonLabel")}
              </label>
              <textarea
                id={`credit-reason-${order.id}`}
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
                className="btn"
              />
            </div>
          </form>
        </details>
      ) : order.creditNotes.length > 0 ? (
        <p className="muted small">
          <strong>{t("creditNoteIssuedLabel")}:</strong>{" "}
          {formatMoney(
            Number(order.creditNotes[0].amount),
            order.creditNotes[0].currency,
            locale,
          )}{" "}
          · {order.creditNotes[0].reason}
        </p>
      ) : null}
    </section>
  );
}
