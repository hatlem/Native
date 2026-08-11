import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { safeExternalUrl } from "@/lib/security";
import { EmptyState } from "@/app/empty-state";
import { markAllRead } from "@/app/notification-actions";
import { SubmitButton } from "@/components";
import { timeAgo } from "@/lib/time-ago";

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
            // Defence-in-depth: any pre-existing publisher-controlled URLs
            // (e.g. liveUrl) saved before the write-side sanitiser would
            // otherwise reach the buyer's <a href>.
            const safeLink = safeExternalUrl(n.link);
            const inner = (
              <>
                <span
                  className={`unread-dot ${n.readAt ? "is-read" : ""}`}
                  aria-hidden
                />
                <div>
                  <div className="title">{n.title}</div>
                  {n.body ? <div className="sub">{n.body}</div> : null}
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
              <Link
                key={n.id}
                href={safeLink}
                className={`item ${n.readAt ? "item-read" : ""}`}
              >
                {inner}
              </Link>
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
