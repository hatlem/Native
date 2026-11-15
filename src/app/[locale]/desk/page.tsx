import { Suspense } from "react";
import { requireDesk } from "@/lib/desk-guard";
import { getTranslations } from "next-intl/server";
import { intlLocale } from "@/lib/money";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { EmptyState } from "@/app/empty-state";
import {
  PageHeader,
  SectionHead,
  Kpi,
  KpiGrid,
  ActionList,
  ActionListItem,
} from "@/components";

export const dynamic = "force-dynamic";

function timeAgo(date: Date, locale: string): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  if (days >= 1) return rtf.format(-days, "day");
  if (hours >= 1) return rtf.format(-hours, "hour");
  if (minutes >= 1) return rtf.format(-minutes, "minute");
  return rtf.format(0, "minute");
}

// Skeleton shown while a desk section's queries run (sections stream in
// independently; the page shell and its links are usable at once).
function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div className="card skel-card" key={i} style={{ marginBottom: 12 }}>
          <div className="skel skel-line" />
          <div className="skel skel-line short" />
        </div>
      ))}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="kpi-grid" aria-busy="true" aria-live="polite">
      {[0, 1, 2].map((i) => (
        <div className="kpi skel-kpi" key={i}>
          <div className="skel skel-line" />
          <div className="skel skel-value" />
          <div className="skel skel-line short" />
        </div>
      ))}
    </div>
  );
}

async function DeskKpis({ locale, isSuperadmin }: { locale: string; isSuperadmin: boolean }) {
  const t = await getTranslations({ locale, namespace: "desk" });
  const to = await getTranslations({ locale, namespace: "order" });
  const tt = await getTranslations({ locale, namespace: "deskTitles" });
  const [submittedCount, inReviewCount, quotedCount, activeOrderCount, pendingTitleCount, unconfirmedCount] =
    await Promise.all([
      prisma.request.count({ where: { status: "SUBMITTED" } }),
      prisma.request.count({ where: { status: "IN_REVIEW" } }),
      prisma.request.count({ where: { status: "QUOTED" } }),
      prisma.order.count({
        where: {
          status: { in: ["CONFIRMED", "IN_PRODUCTION", "SCHEDULED", "LIVE"] },
        },
      }),
      isSuperadmin ? prisma.title.count({ where: { active: false } }) : Promise.resolve(0),
      isSuperadmin
        ? prisma.product.count({ where: { active: true, confirmedAt: null } })
        : Promise.resolve(0),
    ]);
  const needsAttention = submittedCount + inReviewCount;

  return (
    <>
      {unconfirmedCount > 0 && (
        <aside className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <span className="flex-1">
            {t("bannerUnconfirmed", { count: unconfirmedCount })}
          </span>
          <Link
            href="/desk/titles?freshness=never"
            className="whitespace-nowrap font-medium underline underline-offset-2 hover:no-underline"
          >
            {t("bannerReview")}
          </Link>
        </aside>
      )}

      <KpiGrid>
        <Kpi
          primary
          label={t("kpiAttention")}
          value={needsAttention}
          delta={t("kpiAttentionSub")}
          tone={needsAttention > 0 ? "warn" : "neutral"}
          ctaHref={needsAttention > 0 ? "/desk/requests" : undefined}
          ctaLabel={needsAttention > 0 ? t("ctaReview") : undefined}
        />
        <Kpi
          label={t("kpiQuotesOut")}
          value={quotedCount}
          delta={t("kpiQuotesOutSub")}
          ctaHref={quotedCount > 0 ? "/desk/requests?status=QUOTED" : undefined}
          ctaLabel={quotedCount > 0 ? t("ctaReview") : undefined}
        />
        <Kpi
          label={t("kpiActiveOrders")}
          value={activeOrderCount}
          delta={t("kpiActiveOrdersSub")}
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
      </KpiGrid>
    </>
  );
}

async function NewBriefsList({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "desk" });
  const to = await getTranslations({ locale, namespace: "order" });
  const tr = await getTranslations({ locale, namespace: "reports" });
  const [newBriefs, submittedCount] = await Promise.all([
    prisma.request.findMany({
      where: { status: "SUBMITTED" },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        organization: true,
        plan: { include: { _count: { select: { items: true } } } },
      },
    }),
    prisma.request.count({ where: { status: "SUBMITTED" } }),
  ]);
  if (newBriefs.length === 0) {
    return (
      <EmptyState
        title={t("noBriefs")}
        primaryHref="/desk/orders"
        primaryLabel={to("orders")}
        secondaryHref="/desk/reports"
        secondaryLabel={tr("title")}
      />
    );
  }
  return (
    <>
      <p className="muted">
        {t("newBriefsCount", { count: submittedCount })}
        {" · "}
        <Link href="/desk/requests?status=SUBMITTED" className="link">
          {t("requestsViewAll")}
        </Link>
      </p>
      <ActionList>
        {newBriefs.map((r) => (
          <ActionListItem
            key={r.id}
            href={`/desk/${r.id}`}
            badge={<StatusBadge value={r.status} />}
            title={r.organization.name}
            sub={
              <>
                {t("itemsAndAge", {
                  items: r.plan._count.items,
                  age: timeAgo(r.createdAt, locale),
                })}
                {r.briefSummary
                  ? ` · ${r.briefSummary.slice(0, 80)}${r.briefSummary.length > 80 ? "…" : ""}`
                  : ""}
              </>
            }
          />
        ))}
      </ActionList>
    </>
  );
}

async function ActiveRequestsList({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "desk" });
  const activeRequests = await prisma.request.findMany({
    where: { status: { in: ["IN_REVIEW", "QUOTED"] } },
    orderBy: { updatedAt: "desc" },
    take: 8,
    include: {
      organization: true,
      _count: { select: { quotes: true } },
      plan: { include: { _count: { select: { items: true } } } },
    },
  });
  if (activeRequests.length === 0) return <p className="muted">{t("nothingActive")}</p>;
  return (
    <ActionList>
      {activeRequests.map((r) => (
        <ActionListItem
          key={r.id}
          href={`/desk/${r.id}`}
          badge={<StatusBadge value={r.status} />}
          title={r.organization.name}
          sub={t("itemsQuotesAge", {
            items: r.plan._count.items,
            quotes: r._count.quotes,
            age: timeAgo(r.updatedAt, locale),
          })}
        />
      ))}
    </ActionList>
  );
}

export default async function DeskListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // The desk layout guard alone is not an authorization boundary: the page
  // renders alongside it, so its RSC payload reached non-desk users. This
  // runs before anything streams, so the redirect is still a real 307.
  await requireDesk(locale);
  const t = await getTranslations({ locale, namespace: "desk" });
  const to = await getTranslations({ locale, namespace: "order" });
  const tr = await getTranslations({ locale, namespace: "reports" });
  const tt = await getTranslations({ locale, namespace: "deskTitles" });

  const session = await auth();
  const isSuperadmin = session?.user?.role === "SUPERADMIN";

  // Each data section below streams in behind its own Suspense boundary, so
  // the header and navigation paint immediately and one slow query doesn't
  // hold the whole console back.
  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        lead={t("subtitle")}
      />

      <Suspense fallback={<KpiSkeleton />}>
        <DeskKpis locale={locale} isSuperadmin={isSuperadmin} />
      </Suspense>

      <section className="section" id="new-briefs">
        <SectionHead eyebrow={t("sectionInbox")} title={t("newBriefsTitle")} />
        <Suspense fallback={<SectionSkeleton />}>
          <NewBriefsList locale={locale} />
        </Suspense>
      </section>

      <section className="section" id="in-motion">
        <SectionHead
          eyebrow={t("sectionWorking")}
          title={t("workingOnTitle")}
          trailing={
            <Link href="/desk/requests?status=all" className="link">
              {t("requestsViewAll")}
            </Link>
          }
        />
        <Suspense fallback={<SectionSkeleton />}>
          <ActiveRequestsList locale={locale} />
        </Suspense>
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
