import { getTranslations } from "next-intl/server";
import { declineQuote, withdrawRequest } from "@/app/buyer-self-service-actions";
import { canDeclineQuote, canWithdrawRequest, SELF_SERVICE_REASON_MAX } from "@/lib/buyer-self-service";
import { intlLocale } from "@/lib/money";
import { SubmitButton } from "@/components";
import { ViewAsConfirm } from "@/app/view-as-confirm";

type QuoteLite = { id: string; status: string; currency: string; order: { id: string } | null };

const NOTICES: Record<string, { key: string; tone: "info" | "error" }> = {
  "quote-declined": { key: "noticeQuoteDeclined", tone: "info" },
  "request-withdrawn": { key: "noticeRequestWithdrawn", tone: "info" },
  "decline-unavailable": { key: "noticeUnavailable", tone: "error" },
  "withdraw-unavailable": { key: "noticeUnavailable", tone: "error" },
  "decline-not-allowed": { key: "noticeNotAllowed", tone: "error" },
  "withdraw-not-allowed": { key: "noticeNotAllowed", tone: "error" },
};

/** The result banner for a decline / withdraw, rendered near the top of the page. */
export async function BackOutNotice({ locale, notice }: { locale: string; notice: string | undefined }) {
  const n = notice ? NOTICES[notice] : undefined;
  if (!n) return null;
  const t = await getTranslations({ locale, namespace: "requests.selfService" });
  return (
    <div className={n.tone === "error" ? "banner-error" : "banner-info"} role={n.tone === "error" ? "alert" : "status"}>
      <span>{t(n.key)}</span>
    </div>
  );
}

// "Not going ahead?" — the buyer's way out without phoning the desk: decline
// a sent quote, or withdraw the whole request while nothing has been bought.
// Renders nothing once there is nothing left to back out of.
export async function BackOutSection({
  locale,
  requestId,
  requestStatus,
  withdrawnAt,
  quotes,
  canAccept,
  canEdit,
}: {
  locale: string;
  requestId: string;
  requestStatus: string;
  withdrawnAt: Date | null;
  quotes: QuoteLite[];
  canAccept: boolean;
  canEdit: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "requests.selfService" });
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" });

  if (withdrawnAt) {
    return (
      <section className="section">
        <p className="muted" role="status">
          {t("withdrawnBanner", { date: dateFmt.format(withdrawnAt) })}
        </p>
      </section>
    );
  }

  const declinable = quotes.filter(canDeclineQuote);
  const withdrawable = canEdit && canWithdrawRequest({ status: requestStatus, quotes });
  if (declinable.length === 0 && !withdrawable) return null;

  return (
    <section className="section" aria-labelledby="back-out-heading">
      <h2 id="back-out-heading" className="h3">
        {t("heading")}
      </h2>
      <p className="muted">{t("lead")}</p>
      <div className="stack-3">
        {declinable.map((q) =>
          canAccept ? (
            <details key={q.id} className="card">
              <summary>{t("declineOpen", { currency: q.currency })}</summary>
              <form action={declineQuote} className="stack-3" style={{ marginTop: 12 }}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="quoteId" value={q.id} />
                <div className="field">
                  <label htmlFor={`decline-reason-${q.id}`}>{t("reasonLabel")}</label>
                  <textarea
                    id={`decline-reason-${q.id}`}
                    name="reason"
                    rows={3}
                    maxLength={SELF_SERVICE_REASON_MAX}
                  />
                </div>
                <ViewAsConfirm locale={locale} />
                <SubmitButton label={t("declineSubmit")} pendingLabel={t("pending")} className="btn danger" />
              </form>
            </details>
          ) : (
            <p key={q.id} className="muted small">
              {t("needsOrderingRights")}
            </p>
          ),
        )}
        {withdrawable ? (
          <details className="card">
            <summary>{t("withdrawOpen")}</summary>
            <form action={withdrawRequest} className="stack-3" style={{ marginTop: 12 }}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="requestId" value={requestId} />
              <div className="field">
                <label htmlFor="withdraw-reason">{t("reasonLabel")}</label>
                <textarea id="withdraw-reason" name="reason" rows={3} maxLength={SELF_SERVICE_REASON_MAX} />
              </div>
              <SubmitButton label={t("withdrawSubmit")} pendingLabel={t("pending")} className="btn danger" />
            </form>
          </details>
        ) : null}
      </div>
    </section>
  );
}
