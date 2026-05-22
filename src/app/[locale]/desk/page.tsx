import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { EmptyState } from "@/app/empty-state";

export const dynamic = "force-dynamic";

function timeAgo(date: Date, locale: string): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (days >= 1) return rtf.format(-days, "day");
  if (hours >= 1) return rtf.format(-hours, "hour");
  if (minutes >= 1) return rtf.format(-minutes, "minute");
  return rtf.format(0, "minute");
}

export default async function DeskListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "desk" });
  const to = await getTranslations({ locale, namespace: "order" });
  const tr = await getTranslations({ locale, namespace: "reports" });
  const tt = await getTranslations({ locale, namespace: "deskTitles" });

  const session = await auth();
  const isSuperadmin = session?.user?.role === "SUPERADMIN";

  const [
    newBriefs,
    activeRequests,
    submittedCount,
    inReviewCount,
    quotedCount,
    activeOrderCount,
    pendingTitleCount,
  ] = await Promise.all([
    prisma.request.findMany({
      where: { status: "SUBMITTED" },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        organization: true,
        plan: { include: { _count: { select: { items: true } } } },
      },
    }),
    prisma.request.findMany({
      where: { status: { in: ["IN_REVIEW", "QUOTED"] } },
      orderBy: { updatedAt: "desc" },
      take: 8,
      include: {
        organization: true,
        _count: { select: { quotes: true } },
        plan: { include: { _count: { select: { items: true } } } },
      },
    }),
    prisma.request.count({ where: { status: "SUBMITTED" } }),
    prisma.request.count({ where: { status: "IN_REVIEW" } }),
    prisma.request.count({ where: { status: "QUOTED" } }),
    prisma.order.count({
      where: {
        status: { in: ["CONFIRMED", "IN_PRODUCTION", "SCHEDULED", "LIVE"] },
      },
    }),
    isSuperadmin
      ? prisma.title.count({ where: { active: false } })
      : Promise.resolve(0),
  ]);

  const needsAttention = submittedCount + inReviewCount;

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("subtitle")}</p>
      </header>

      <div className="kpi-grid">
        <Kpi
          label={t("kpiAttention")}
          value={needsAttention}
          delta={t("kpiAttentionSub")}
          tone={needsAttention > 0 ? "warn" : "neutral"}
          ctaHref={needsAttention > 0 ? "#new-briefs" : undefined}
          ctaLabel={needsAttention > 0 ? t("ctaReview") : undefined}
        />
        <Kpi
          label={t("kpiQuotesOut")}
          value={quotedCount}
          delta={t("kpiQuotesOutSub")}
          tone="neutral"
        />
        <Kpi
          label={t("kpiActiveOrders")}
          value={activeOrderCount}
          delta={t("kpiActiveOrdersSub")}
          tone="neutral"
          ctaHref={activeOrderCount > 0 ? "/desk/orders" : undefined}
          ctaLabel={activeOrderCount > 0 ? to("orders") : undefined}
        />
        {isSuperadmin ? (
          <Kpi
            label={t("kpiPendingTitles")}
            value={pendingTitleCount}
            delta={t("kpiPendingTitlesSub")}
            tone={pendingTitleCount > 0 ? "warn" : "neutral"}
            ctaHref={pendingTitleCount > 0 ? "/desk/titles" : undefined}
            ctaLabel={pendingTitleCount > 0 ? tt("title") : undefined}
          />
        ) : null}
      </div>

      <section className="section" id="new-briefs">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("sectionInbox")}</span>
            <h2>{t("newBriefsTitle")}</h2>
          </div>
          {newBriefs.length > 0 ? (
            <span className="muted">
              {t("newBriefsCount", { count: submittedCount })}
            </span>
          ) : null}
        </div>
        {newBriefs.length === 0 ? (
          <EmptyState
            title={t("noBriefs")}
            primaryHref="/desk/orders"
            primaryLabel={to("orders")}
            secondaryHref="/desk/reports"
            secondaryLabel={tr("title")}
          />
        ) : (
          <div className="action-list">
            {newBriefs.map((r) => (
              <Link
                key={r.id}
                href={`/desk/${r.id}`}
                className="item item-link"
              >
                <StatusBadge value={r.status} />
                <div>
                  <div className="title">{r.organization.name}</div>
                  <div className="sub">
                    {t("itemsAndAge", {
                      items: r.plan._count.items,
                      age: timeAgo(r.createdAt, locale),
                    })}
                    {r.briefSummary ? ` · ${r.briefSummary.slice(0, 80)}${r.briefSummary.length > 80 ? "…" : ""}` : ""}
                  </div>
                </div>
                <span className="chev" aria-hidden>→</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("sectionWorking")}</span>
            <h2>{t("workingOnTitle")}</h2>
          </div>
        </div>
        {activeRequests.length === 0 ? (
          <p className="muted">{t("nothingActive")}</p>
        ) : (
          <div className="action-list">
            {activeRequests.map((r) => (
              <Link
                key={r.id}
                href={`/desk/${r.id}`}
                className="item item-link"
              >
                <StatusBadge value={r.status} />
                <div>
                  <div className="title">{r.organization.name}</div>
                  <div className="sub">
                    {t("itemsQuotesAge", {
                      items: r.plan._count.items,
                      quotes: r._count.quotes,
                      age: timeAgo(r.updatedAt, locale),
                    })}
                  </div>
                </div>
                <span className="chev" aria-hidden>→</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="grid two">
          <Link href="/desk/orders" className="card hoverable quick-link">
            <h3>{to("orders")}</h3>
            <p className="muted">{t("ordersBlurb")}</p>
            <span className="link">{t("openLink")} →</span>
          </Link>
          <Link href="/desk/reports" className="card hoverable quick-link">
            <h3>{tr("title")}</h3>
            <p className="muted">{t("reportsBlurb")}</p>
            <span className="link">{t("openLink")} →</span>
          </Link>
          {isSuperadmin ? (
            <Link href="/desk/titles" className="card hoverable quick-link">
              <h3>{tt("title")}</h3>
              <p className="muted">{t("titlesBlurb")}</p>
              <span className="link">{t("openLink")} →</span>
            </Link>
          ) : null}
        </div>
      </section>
    </>
  );
}

function Kpi({
  label,
  value,
  delta,
  tone,
  ctaHref,
  ctaLabel,
}: {
  label: string;
  value: number;
  delta?: string;
  tone?: "warn" | "neutral";
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className={`kpi ${tone === "warn" ? "kpi-warn" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta ? <div className="delta">{delta}</div> : null}
      {ctaHref && ctaLabel ? (
        <Link href={ctaHref} className="cta">
          {ctaLabel} →
        </Link>
      ) : null}
    </div>
  );
}
