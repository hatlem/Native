import { getTranslations } from "next-intl/server";
import type { Invoice, OrderStatus, Prisma } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { advanceOrder, cancelOrder } from "@/app/desk-actions";
import { issueInvoice } from "@/app/desk-billing-actions";
import { StatusBadge } from "@/app/status-badge";
import { canCancelOrder, cancelBlockKey } from "@/lib/cancellation";
import {
  canIssueInvoice,
  creditNoteEligibility,
  type DeliveryGap,
} from "@/lib/order-lifecycle";
import { paymentTermsDaysFor } from "@/lib/payment-terms";
import { SubmitButton } from "@/components";
import { CreditNoteForm } from "./credit-note-form";

type OrderForHeader = Prisma.OrderGetPayload<{
  include: { organization: true; quote: true; invoices: true; creditNotes: true };
}>;

type Props = {
  locale: string;
  order: OrderForHeader;
  invoice: Invoice | undefined;
  // The status "Advance" moves to (null when the order is off the flow),
  // and the delivery evidence behind it (order-lifecycle.ts).
  next: OrderStatus | null;
  gap: DeliveryGap;
};

export async function OrderHeader({ locale, order, invoice, next, gap }: Props) {
  const t = await getTranslations({ locale, namespace: "order" });
  const td = await getTranslations({ locale, namespace: "desk" });
  const tPay = await getTranslations({ locale, namespace: "paymentTerms" });

  const credit = creditNoteEligibility(order.status, order.invoices, order.creditNotes);
  const blockKey = cancelBlockKey(order.status);

  return (
    <header className="detail-head">
      <div>
        <span className="eyebrow accent">{td("eyebrow")}</span>
        <h1>
          {t("title")} · {order.organization.name}
        </h1>
        <p className="lead">{t("deskDetailLead")}</p>
      </div>
      <aside className="detail-meta">
        <div className="meta-row">
          <span className="muted small">{t("status")}</span>
          <span className="value">
            <StatusBadge value={order.status} />
          </span>
        </div>
        <div className="meta-row">
          <span className="muted small">{t("total")}</span>
          <span className="value">
            {formatMoney(
              Number(order.quote.total),
              order.quote.currency,
              locale,
            )}
          </span>
        </div>
        <div className="detail-actions">
          {next ? (
            <form action={advanceOrder}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="from" value={order.status} />
              {gap.needsConfirmation ? (
                // Advancing into LIVE/COMPLETED tells the buyer the campaign
                // ran. Show what has no evidence and make the desk confirm.
                <div className="banner-info" role="note" style={{ marginBottom: 8 }}>
                  <strong>{t("advanceGuardTitle", { missing: gap.missing.length })}</strong>
                  <p className="small" style={{ margin: "4px 0" }}>
                    {next === "LIVE" ? t("advanceGuardLeadLive") : t("advanceGuardLeadCompleted")}
                  </p>
                  <ul className="small" style={{ margin: "4px 0 8px", paddingLeft: 18 }}>
                    {gap.missing.map((l) => (
                      <li key={l.id}>{l.label}</li>
                    ))}
                  </ul>
                  <label className="small" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <input type="checkbox" name="confirmUndelivered" required />
                    <span>{t("advanceGuardConfirm")}</span>
                  </label>
                  <p className="muted small" style={{ margin: "4px 0 0" }}>
                    {t("advanceGuardNote")}
                  </p>
                </div>
              ) : null}
              <SubmitButton
                label={t("advance")}
                pendingLabel={t("advancing")}
                className="btn block"
              />
            </form>
          ) : null}
          {canIssueInvoice(order.status, order.invoices) ? (
            <form action={issueInvoice}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="orderId" value={order.id} />
              <p className="muted small" style={{ margin: "0 0 6px" }}>
                {tPay("line", { days: paymentTermsDaysFor(order.organization) })}
              </p>
              <SubmitButton
                label={t("issueInvoice")}
                pendingLabel={t("issuingInvoice")}
                className="btn block"
              />
            </form>
          ) : null}
          {invoice ? (
            <Link
              className="btn secondary block"
              href={`/invoices/${invoice.id}`}
            >
              {t("viewInvoice")}
            </Link>
          ) : null}
          {order.status === "INVOICED" && credit.ok ? (
            <CreditNoteForm locale={locale} orderId={order.id} invoice={credit.invoice} />
          ) : null}
          {canCancelOrder(order.status) ? (
            <details className="spec-details">
              <summary>
                <span className="btn secondary block">
                  {t("cancelButton")}
                </span>
              </summary>
              <form action={cancelOrder} className="product-form">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="orderId" value={order.id} />
                <h4 style={{ margin: "12px 0 4px" }}>{t("cancelTitle")}</h4>
                <p className="muted small">{t("cancelHint")}</p>
                <div className="field">
                  <label htmlFor={`cancel-reason-${order.id}`}>
                    {t("cancelReasonLabel")}
                  </label>
                  <textarea
                    id={`cancel-reason-${order.id}`}
                    name="reason"
                    rows={4}
                    required
                    placeholder={t("cancelReasonPlaceholder")}
                  />
                </div>
                <div className="actions">
                  <SubmitButton
                    label={t("cancelSubmit")}
                    pendingLabel={t("cancelling")}
                    className="btn block"
                  />
                </div>
              </form>
            </details>
          ) : blockKey && blockKey !== "cancelled" ? (
            <p className="muted small">{t(`cancelBlock.${blockKey}`)}</p>
          ) : null}
        </div>
      </aside>
    </header>
  );
}
