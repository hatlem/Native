import { getTranslations } from "next-intl/server";
import type { Invoice, Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { formatZonedDateTime } from "@/lib/time-zone";
import { creditNoteEligibility } from "@/lib/order-lifecycle";
import { CreditNoteForm } from "./credit-note-form";

type OrderForCancelledSummary = Prisma.OrderGetPayload<{
  include: { creditNotes: true; invoices: true };
}>;

type Props = {
  locale: string;
  order: OrderForCancelledSummary;
  invoice: Invoice | undefined;
  // The customer org's zone (house zone until it has a market) — the same
  // clock the rest of the order's dates are read on.
  timeZone: string;
};

export async function CancelledSummary({ locale, order, invoice, timeZone }: Props) {
  if (!(order.status === "CANCELLED" && order.cancelledAt)) return null;
  const t = await getTranslations({ locale, namespace: "order" });
  const credit = order.creditNotes[0];
  // A cancelled order normally has no open invoice (a full credit note is
  // what cancels an invoiced one), but legacy data can — let the desk put
  // it right here.
  const eligibility = creditNoteEligibility(order.status, order.invoices, order.creditNotes);

  return (
    <section className="cancelled-summary">
      <h2>{t("cancelledAtLabel")}</h2>
      <dl className="spec-grid">
        <dt>{t("cancelledAtLabel")}</dt>
        <dd>{formatZonedDateTime(order.cancelledAt, locale, timeZone)}</dd>
        {order.cancelledBy ? (
          <>
            <dt>{t("cancelledByLabel")}</dt>
            {/* cancelledBy records the acting role (see CancelActor). */}
            <dd>
              {t.has(`cancelledByRole.${order.cancelledBy}`)
                ? t(`cancelledByRole.${order.cancelledBy}`)
                : order.cancelledBy}
            </dd>
          </>
        ) : null}
        {order.cancelReason ? (
          <>
            <dt>{t("cancelledReasonLabel")}</dt>
            <dd>{order.cancelReason}</dd>
          </>
        ) : null}
      </dl>

      {credit ? (
        <p className="muted small">
          <strong>{t("creditNoteIssuedLabel")}:</strong>{" "}
          {formatMoney(Number(credit.amount), credit.currency, locale)} · {credit.reason}
        </p>
      ) : eligibility.ok && invoice ? (
        <CreditNoteForm locale={locale} orderId={order.id} invoice={eligibility.invoice} />
      ) : null}
    </section>
  );
}
