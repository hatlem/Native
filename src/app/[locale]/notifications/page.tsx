import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { safeExternalUrl } from "@/lib/security";
import { EmptyState } from "@/app/empty-state";
import { markAllRead } from "@/app/notification-actions";
import { SubmitButton } from "@/components";
import { timeAgo } from "@/lib/time-ago";
import { safeLocale } from "@/i18n/routing";
import { renderStoredNotice } from "@/lib/notice-template";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "notifications" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const session = await auth();

  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const rows = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const unread = rows.filter((n) => !n.readAt).length;
  const viewerLocale = safeLocale(locale);

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      <div className="result-bar">
        <div className="result-bar-summary">
          <strong>
            {t("unreadCount", { count: unread })}
          </strong>
          <span className="muted small">
            {t("totalCount", { count: rows.length })}
          </span>
        </div>
        {unread > 0 ? (
          <form action={markAllRead} className="result-bar-action">
            <input type="hidden" name="locale" value={locale} />
            <SubmitButton
              label={t("markAll")}
              pendingLabel={t("markingAll")}
              className="btn small secondary"
            />
          </form>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={t("none")}
          primaryHref="/catalog"
          primaryLabel={tNav("catalog")}
        />
      ) : (
        <div className="action-list">
          {rows.map((n) => {
            // A templated notice re-renders in the VIEWER's language (its
            // stored strings are in the org market's language — Swedish for
            // a Norwegian user in a Swedish-market org). Legacy and free-text
            // rows fall back to what was stored. lib/notice-template.ts.
            const shown = renderStoredNotice(n.messageKey, n.messageParams, viewerLocale) ?? {
              title: n.title,
              body: n.body,
              link: n.link,
            };
            // Defence-in-depth: any pre-existing publisher-controlled URLs
            // (e.g. liveUrl) saved before the write-side sanitiser would
            // otherwise reach the buyer's <a href>.
            // Plain <a>, not next-intl's <Link>: the link is an
            // already-complete path (e.g. "/no/plan/<id>") that carries its
            // locale. next-intl's <Link> always prepends the CURRENT locale to
            // any local href it's given, with no awareness a href might
            // already carry one — that would double-prefix the URL (404).
            const safeLink = safeExternalUrl(shown.link);
            const inner = (
              <>
                <span
                  className={`unread-dot ${n.readAt ? "is-read" : ""}`}
                  aria-hidden
                />
                <div>
                  <div className="title">{shown.title}</div>
                  {/* Multi-paragraph bodies (a request's brief and lines, a
                      reviewer's comment) keep their line breaks. */}
                  {shown.body ? (
                    <div className="sub" style={{ whiteSpace: "pre-line" }}>
                      {shown.body}
                    </div>
                  ) : null}
                  <div className="muted small mt-1">
                    {timeAgo(n.createdAt, locale)}
                  </div>
                </div>
                {safeLink ? (
                  <span className="chev" aria-hidden>
                    →
                  </span>
                ) : null}
              </>
            );
            return safeLink ? (
              <a
                key={n.id}
                href={safeLink}
                className={`item ${n.readAt ? "item-read" : ""}`}
              >
                {inner}
              </a>
            ) : (
              <div
                key={n.id}
                className={`item ${n.readAt ? "item-read" : ""}`}
              >
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
