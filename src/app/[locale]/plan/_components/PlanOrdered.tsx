import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { intlLocale } from "@/lib/money";
import { duplicatePlan } from "@/app/plan-actions";
import { SubmitButton } from "@/components";
import type { ListOrder } from "@/lib/commerce/list-commit";

// Where the send/order form was, once the plan has been ordered: when, a link
// to the order, and the way to book these lines again. An ordered plan is
// spent (lib/commerce/list-commit.ts): ordering it again would book every
// line twice, so the next commitment is a new plan — "Plan next wave" copies
// this one, ready to edit, exactly as the finished order page offers.
export async function PlanOrdered({
  locale,
  ordered,
  timeZone,
  canEdit,
}: {
  locale: string;
  ordered: ListOrder;
  // The buyer's zone: "ordered 30 Sep" is a day on their calendar.
  timeZone: string;
  // Copying the plan creates one — not for a view-only seat.
  canEdit: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });
  const to = await getTranslations({ locale, namespace: "orders" });
  const date = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(ordered.orderedAt);
  // One order per placement market: a single order opens directly, several
  // are listed on their request.
  const href =
    ordered.orderIds.length === 1 ? `/orders/${ordered.orderIds[0]}` : `/requests/${ordered.requestId}`;

  return (
    <div className="plan-ordered" role="status">
      <p className="plan-ordered__title">✓ {t("orderedTitle", { date })}</p>
      <p className="muted small">{t("orderedBody")}</p>
      <Link href={href} className="btn block">
        {t("orderedView")}
      </Link>
      {canEdit ? (
        <form action={duplicatePlan}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="orderId" value={ordered.orderIds[0]} />
          <SubmitButton
            label={to("useAsTemplate")}
            pendingLabel={to("duplicating")}
            className="btn block secondary"
          />
        </form>
      ) : null}
    </div>
  );
}
