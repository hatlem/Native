import { getTranslations } from "next-intl/server";
import { requestOrderCancellation, submitOrderFeedback } from "@/app/buyer-self-service-actions";
import {
  canGiveFeedback,
  canRequestCancellation,
  SELF_SERVICE_REASON_MAX,
} from "@/lib/buyer-self-service";
import { intlLocale } from "@/lib/money";
import { SubmitButton } from "@/components";
import { ViewAsConfirm } from "@/app/view-as-confirm";

const NOTICES: Record<string, { key: string; tone: "info" | "error" }> = {
  "cancel-requested": { key: "noticeRequested", tone: "info" },
  "cancel-reason-required": { key: "noticeReasonRequired", tone: "error" },
  "cancel-unavailable": { key: "noticeUnavailable", tone: "error" },
  "cancel-not-allowed": { key: "noticeNotAllowed", tone: "error" },
};

export async function OrderSelfServiceNotice({ locale, notice }: { locale: string; notice: string | undefined }) {
  const n = notice ? NOTICES[notice] : undefined;
  if (!n) return null;
  const t = await getTranslations({ locale, namespace: "order.cancelRequest" });
  return (
    <div className={n.tone === "error" ? "banner-error" : "banner-info"} role={n.tone === "error" ? "alert" : "status"}>
      <span>{t(n.key)}</span>
    </div>
  );
}

// Buyer side of cancelling: a request to the desk (publisher bookings may
// carry terms), shown as pending until the desk cancels the order.
export async function OrderCancelRequestSection({
  locale,
  order,
  canCommit,
}: {
  locale: string;
  order: { id: string; status: string; cancellationRequestedAt: Date | null };
  canCommit: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "order.cancelRequest" });
  if (order.cancellationRequestedAt && order.status !== "CANCELLED") {
    const date = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(
      order.cancellationRequestedAt,
    );
    return (
      <section className="section">
        <div className="banner-info" role="status">
          <span>{t("requested", { date })}</span>
        </div>
      </section>
    );
  }
  if (!canRequestCancellation(order)) return null;
  return (
    <section className="section" aria-labelledby="cancel-request-heading">
      <h2 id="cancel-request-heading" className="h3">
        {t("heading")}
      </h2>
      {canCommit ? (
        <details className="card">
          <summary>{t("open")}</summary>
          <p className="muted" style={{ marginTop: 12 }}>
            {t("lead")}
          </p>
          <form action={requestOrderCancellation} className="stack-3">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={order.id} />
            <div className="field">
              <label htmlFor="cancel-reason">{t("reasonLabel")}</label>
              <textarea id="cancel-reason" name="reason" rows={3} required maxLength={SELF_SERVICE_REASON_MAX} />
            </div>
            <ViewAsConfirm locale={locale} />
            <SubmitButton label={t("submit")} pendingLabel={t("pending")} className="btn danger" />
          </form>
        </details>
      ) : (
        <p className="muted small">{t("noticeNotAllowed")}</p>
      )}
    </section>
  );
}

// One question once the order is delivered; the answer is kept and shown back.
export async function OrderCsatSection({
  locale,
  order,
  feedback,
  canEdit,
}: {
  locale: string;
  order: { id: string; status: string };
  feedback: { score: number } | null;
  canEdit: boolean;
}) {
  if (!canGiveFeedback(order.status)) return null;
  const t = await getTranslations({ locale, namespace: "order.csat" });
  if (feedback) {
    return (
      <section className="section" id="feedback">
        <p className="muted" role="status">
          {t("thanks", { score: feedback.score })}
        </p>
      </section>
    );
  }
  if (!canEdit) return null;
  return (
    <section className="section" id="feedback" aria-labelledby="csat-heading">
      <h2 id="csat-heading" className="h3">
        {t("heading")}
      </h2>
      <form action={submitOrderFeedback} className="card stack-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="orderId" value={order.id} />
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>{t("question")}</legend>
          <div className="cluster" style={{ gap: 12, alignItems: "center" }}>
            <span className="muted small">{t("low")}</span>
            {[1, 2, 3, 4, 5].map((score) => (
              <label key={score} className="cluster" style={{ gap: 4, minHeight: 44, alignItems: "center" }}>
                <input type="radio" name="score" value={score} required aria-label={t("scale", { score })} />
                <span aria-hidden="true">{score}</span>
              </label>
            ))}
            <span className="muted small">{t("high")}</span>
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="csat-comment">{t("commentLabel")}</label>
          <textarea id="csat-comment" name="comment" rows={2} maxLength={SELF_SERVICE_REASON_MAX} />
        </div>
        <SubmitButton label={t("submit")} pendingLabel={t("pending")} className="btn" />
      </form>
    </section>
  );
}
