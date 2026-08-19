import { getTranslations } from "next-intl/server";
import { Link2 } from "lucide-react";
import { shareList, unshareList } from "@/app/list-actions";
import { shareUrl } from "@/lib/list-share";
import { appUrl } from "@/lib/url";
import { intlLocale } from "@/lib/money";

// Client-share control: a native <details> (same pattern as PlanTargeting)
// that mints/kills the read-only share link for this list. The URL renders in
// a readonly input the buyer copies by hand — no clipboard JS, so the whole
// control stays a server component.
export async function PlanShare({
  locale,
  listId,
  shareToken,
  shareViewedAt,
  shareViewCount,
  clientApprovedAt,
}: {
  locale: string;
  listId: string;
  shareToken: string | null;
  shareViewedAt: Date | null;
  shareViewCount: number;
  clientApprovedAt: Date | null;
}) {
  const t = await getTranslations({ locale, namespace: "plan.share" });
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <details className="plan-share" open={!!shareToken}>
      <summary className="plan-share__summary">
        <Link2 size={15} strokeWidth={1.8} aria-hidden="true" />
        <span>{t("summary")}</span>
        {clientApprovedAt ? (
          <span className="badge badge-success dotless">{t("approvedBadge")}</span>
        ) : shareToken ? (
          <span className="badge badge-success dotless">{t("activeBadge")}</span>
        ) : null}
      </summary>
      <div className="plan-share__body">
        {shareToken ? (
          <>
            <p className="muted small">{t("activeHint")}</p>
            <p className="muted small plan-share__engagement">
              {clientApprovedAt
                ? t("engagementApproved", { date: dateFmt.format(clientApprovedAt) })
                : shareViewedAt
                  ? t("engagementViewed", { date: dateFmt.format(shareViewedAt), count: shareViewCount })
                  : t("engagementNone")}
            </p>
            <input
              type="text"
              readOnly
              value={shareUrl(appUrl(), locale, shareToken)}
              aria-label={t("urlLabel")}
              className="plan-share__url"
            />
            <div className="plan-share__actions">
              <form action={shareList}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="listId" value={listId} />
                <button type="submit" className="btn small secondary">
                  {t("regenerate")}
                </button>
              </form>
              <form action={unshareList}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="listId" value={listId} />
                <button type="submit" className="btn small ghost">
                  {t("disable")}
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">{t("offHint")}</p>
            <form action={shareList}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="listId" value={listId} />
              <button type="submit" className="btn small">
                {t("enable")}
              </button>
            </form>
          </>
        )}
      </div>
    </details>
  );
}
