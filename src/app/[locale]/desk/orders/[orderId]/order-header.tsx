import { getTranslations } from "next-intl/server";
import type { Invoice, Prisma } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { advanceOrder, cancelOrder } from "@/app/desk-actions";
import { issueInvoice } from "@/app/desk-billing-actions";
import { StatusBadge } from "@/app/status-badge";
import { canCancelOrder, cancelBlockReason } from "@/lib/cancellation";
import { SubmitButton } from "@/components";

const NON_ADVANCEABLE = ["COMPLETED", "INVOICED", "CANCELLED"];

type OrderForHeader = Prisma.OrderGetPayload<{
  include: { organization: true; quote: true };
}>;

type Props = {
  locale: string;
  order: OrderForHeader;
  invoice: Invoice | undefined;
};

export async function OrderHeader({ locale, order, invoice }: Props) {
  const t = await getTranslations({ locale, namespace: "order" });
  const td = await getTranslations({ locale, namespace: "desk" });

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
          {!NON_ADVANCEABLE.includes(order.status) ? (
            <form action={advanceOrder}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="orderId" value={order.id} />
              <SubmitButton
                label={t("advance")}
                pendingLabel={t("advancing")}
                className="btn block"
              />
            </form>
          ) : null}
          {order.status === "COMPLETED" && !invoice ? (
            <form action={issueInvoice}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="orderId" value={order.id} />
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
          ) : order.status !== "CANCELLED" ? (
            <p className="muted small">
              {t("cancelBlocked")} {cancelBlockReason(order.status)}
            </p>
          ) : null}
        </div>
      </aside>
    </header>
  );
}
