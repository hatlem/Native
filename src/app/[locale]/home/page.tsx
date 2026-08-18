import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadScope } from "@/lib/scope";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { EmptyState } from "@/app/empty-state";
import { formatMoney, intlLocale } from "@/lib/money";
import { timeAgo } from "@/lib/time-ago";
import { campaignFlowEnabled } from "@/lib/flags";
import { FileCheck, PenLine, Search, RotateCcw, Repeat } from "lucide-react";
import { findDueWaves } from "@/lib/programme";
import { selectActiveList } from "@/app/list-actions";

export const dynamic = "force-dynamic";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const scope = await loadScope();
  if (!scope.workspace) redirect(`/${locale}/signin`);
  const orgIds = scope.workspace.scopeOrgIds;

  const t = await getTranslations({ locale, namespace: "buyerHome" });

  // "Needs you": quotes sent by the desk awaiting the buyer's approval,
  // plus content drafts a writer has moved to review. ContentAsset has no
  // buyer-facing approve action yet — the card links to the order it
  // belongs to (the closest existing surface) rather than inventing one.
  const [pendingQuotes, pendingContent, orders, dueWaves] = await Promise.all([
    prisma.quote.findMany({
      where: { status: "SENT", request: { organizationId: { in: orgIds } } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        total: true,
        currency: true,
        validUntil: true,
        request: { select: { id: true, plan: { select: { name: true } } } },
      },
    }),
    prisma.contentAsset.findMany({
      where: { status: "IN_REVIEW", brief: { orderLine: { order: { organizationId: { in: orgIds } } } } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        brief: {
          select: {
            orderLine: {
              select: { order: { select: { id: true } }, booking: { select: { title: { select: { name: true } } } } },
            },
          },
        },
      },
    }),
    prisma.order.findMany({
      where: { organizationId: { in: orgIds }, status: { in: ["CONFIRMED", "IN_PRODUCTION", "SCHEDULED", "LIVE"] } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: {
        id: true,
        status: true,
        flightStartDate: true,
        flightEndDate: true,
        organization: { select: { name: true } },
        quote: { select: { currency: true, total: true, request: { select: { plan: { select: { name: true } } } } } },
        lines: { select: { id: true } },
      },
    }),
    // Programme waves whose turn it is: the previous wave is live/finished, or
    // this wave's start is close. Scoped to the ACTIVE org only, because the
    // CTA switches the active list (selectActiveList → /plan), which only
    // ever renders the active org's lists.
    scope.workspace.activeOrgId ? findDueWaves([scope.workspace.activeOrgId], new Date()) : Promise.resolve([]),
  ]);

  const needsCount = pendingQuotes.length + pendingContent.length + dueWaves.length;
  const runningCount = orders.length;
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" });

  const startHref = campaignFlowEnabled() ? "/campaign" : "/catalog";

  return (
    <section>
      <h1>
        {needsCount > 0
          ? t("headingNeeds", { count: needsCount })
          : runningCount > 0
            ? t("headingRunning", { count: runningCount })
            : t("headingIdle")}
      </h1>
      <p className="muted">
        {needsCount > 0 || runningCount > 0
          ? t("sub", { needs: needsCount, running: runningCount })
          : t("subIdle")}
      </p>

      {needsCount > 0 ? (
        <div className="home-needs-list">
          {pendingQuotes.map((q) => (
            <div className="home-needs-card home-needs-card--accent" key={`quote-${q.id}`}>
              <span className="home-needs-card__icon" aria-hidden="true">
                <FileCheck size={19} strokeWidth={1.7} />
              </span>
              <div className="home-needs-card__body">
                <div className="home-needs-card__title-row">
                  <span className="home-needs-card__title">{q.request.plan.name}</span>
                  {q.validUntil ? (
                    <span className="badge badge-warning dotless">
                      {t("expiresIn", { date: dateFmt.format(q.validUntil) })}
                    </span>
                  ) : null}
                </div>
                <p className="home-needs-card__desc">
                  {t("quoteReadyBody", { amount: formatMoney(Number(q.total), q.currency, locale) })}
                </p>
              </div>
              <Link href={`/requests/${q.request.id}`} className="btn small">
                {t("reviewQuote")}
              </Link>
            </div>
          ))}
          {dueWaves.map((w) => (
            <div className="home-needs-card home-needs-card--accent" key={`wave-${w.listId}`}>
              <span className="home-needs-card__icon" aria-hidden="true">
                <Repeat size={19} strokeWidth={1.7} />
              </span>
              <div className="home-needs-card__body">
                <div className="home-needs-card__title-row">
                  <span className="home-needs-card__title">
                    {t("nextWaveTitle", { name: w.programmeName, n: w.waveNumber, of: w.plannedWaves })}
                  </span>
                  {w.scheduleStart ? (
                    <span className="badge badge-info dotless">{dateFmt.format(w.scheduleStart)}</span>
                  ) : null}
                </div>
                <p className="home-needs-card__desc">
                  {w.reason === "previous-live"
                    ? t("nextWaveBodyPreviousLive", { prev: w.waveNumber - 1, n: w.waveNumber })
                    : w.reason === "previous-done"
                      ? t("nextWaveBodyPreviousDone", { prev: w.waveNumber - 1, n: w.waveNumber })
                      : t("nextWaveBodyDateNear", {
                          n: w.waveNumber,
                          date: w.scheduleStart ? dateFmt.format(w.scheduleStart) : "",
                        })}
                  {w.articleAngle ? <> {t("nextWaveAngle", { angle: w.articleAngle })}</> : null}
                </p>
              </div>
              <form action={selectActiveList}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="listId" value={w.listId} />
                <button type="submit" className="btn small">
                  {t("openWave")}
                </button>
              </form>
            </div>
          ))}
          {pendingContent.map((c) => {
            const orderId = c.brief.orderLine.order.id;
            const titleName = c.brief.orderLine.booking?.title?.name ?? "";
            return (
              <div className="home-needs-card home-needs-card--success" key={`content-${c.id}`}>
                <span className="home-needs-card__icon home-needs-card__icon--success" aria-hidden="true">
                  <PenLine size={19} strokeWidth={1.7} />
                </span>
                <div className="home-needs-card__body">
                  <div className="home-needs-card__title-row">
                    <span className="home-needs-card__title">{t("draftReadyTitle")}</span>
                    {titleName ? (
                      <span className="badge badge-success dotless">{titleName}</span>
                    ) : null}
                  </div>
                  <p className="home-needs-card__desc">{t("draftReadyBody")}</p>
                </div>
                <Link href={`/orders/${orderId}`} className="btn small secondary">
                  {t("readDrafts")}
                </Link>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="home-lower-grid">
        <div>
          <div className="home-section-head">
            <h2>{t("runningHeading")}</h2>
            <Link href="/requests?tab=orders" className="link small">
              {t("allCampaigns")} →
            </Link>
          </div>
          {orders.length === 0 ? (
            <EmptyState title={t("runningEmpty")} primaryHref="/catalog" primaryLabel={t("browseCatalog")} />
          ) : (
            <div className="home-running-list">
              {orders.map((o) => {
                const total = o.quote ? Number(o.quote.total) : 0;
                const currency = o.quote?.currency ?? "EUR";
                return (
                  <Link href={`/orders/${o.id}`} className="home-running-row" key={o.id}>
                    <StatusBadge value={o.status} />
                    <div>
                      <div className="home-running-row__name">
                        {o.quote?.request.plan.name ?? o.organization.name}
                      </div>
                      <div className="home-running-row__meta">{o.organization.name}</div>
                    </div>
                    <div className="home-running-row__metric">
                      <div className="home-running-row__metric-value">{formatMoney(total, currency, locale)}</div>
                      <div className="home-running-row__metric-label">{t("lines", { count: o.lines.length })}</div>
                    </div>
                    <div className="home-running-row__date">
                      {o.flightEndDate ? dateFmt.format(o.flightEndDate) : ""}
                    </div>
                    <span className="home-running-row__chevron" aria-hidden="true">
                      →
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="home-start-card">
          <h2>{t("startHeading")}</h2>
          <Link href={startHref} className="btn block home-start-btn">
            <PenLine size={17} strokeWidth={1.7} aria-hidden="true" />
            {t("startDescribe")}
          </Link>
          <Link href="/catalog" className="btn secondary block home-start-btn">
            <Search size={17} strokeWidth={1.7} aria-hidden="true" />
            {t("startBrowse")}
          </Link>
          {/* Finished campaigns live on the Done tab; each order there offers
              "Plan next wave" (a full copy of the list, ready to edit). */}
          <Link href="/requests?tab=done" className="btn secondary block home-start-btn">
            <RotateCcw size={17} strokeWidth={1.7} aria-hidden="true" />
            {t("startRepeat")}
          </Link>
        </div>
      </div>
    </section>
  );
}
