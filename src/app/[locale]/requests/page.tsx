import { getTranslations } from "next-intl/server";
import { intlLocale, formatMoney } from "@/lib/money";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { loadUnsentLists } from "@/lib/lists";
import { estimateListTotals } from "@/lib/plan-total";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { EmptyState } from "@/app/empty-state";
import { DraftListRow } from "./_components/DraftListRow";

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

export default async function RequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "requests" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const session = await auth();

  const ws = await getWorkspace(session?.user?.id);
  if (!ws) redirect(`/${locale}/signin`);

  const [requests, draftCount, quotedCount, acceptedCount, unsentLists] = await Promise.all([
    prisma.request.findMany({
      where: { organizationId: { in: ws.scopeOrgIds } },
      orderBy: { createdAt: "desc" },
      include: {
        plan: { select: { name: true, items: true } },
        quotes: { select: { id: true }, take: 1 },
      },
    }),
    prisma.request.count({
      where: { organizationId: { in: ws.scopeOrgIds }, status: "DRAFT" },
    }),
    prisma.request.count({
      where: { organizationId: { in: ws.scopeOrgIds }, status: "QUOTED" },
    }),
    prisma.request.count({
      where: { organizationId: { in: ws.scopeOrgIds }, status: "CLOSED" },
    }),
    // Scoped to the active org only (not the full agency scopeOrgIds): the
    // "Continue" action reuses selectActiveList -> /plan, which itself only
    // ever renders the active org's lists — surfacing a different client's
    // drafts here would silently resolve to the wrong list on /plan.
    ws.activeOrgId ? loadUnsentLists(ws.activeOrgId) : Promise.resolve([]),
  ]);

  const drafts = unsentLists.map((list) => {
    const totals = estimateListTotals(list.items);
    return {
      id: list.id,
      name: list.name,
      itemCount: list._count.items,
      age: timeAgo(list.updatedAt, locale),
      amountLabel: totals.length
        ? totals.map((tot) => formatMoney(tot.amount, tot.currency, locale)).join(" + ")
        : null,
    };
  });

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("listTitle")}</h1>
        <p className="lead">{t("listLead")}</p>
      </header>

      {drafts.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <div>
              <h2>{t("draftListsHeading")}</h2>
              <p className="lead">{t("draftListsLead")}</p>
            </div>
          </div>
          <div className="action-list">
            {drafts.map((d) => (
              <DraftListRow
                key={d.id}
                locale={locale}
                listId={d.id}
                name={d.name}
                badgeLabel={t("draftListsHeading")}
                metaLabel={t("itemsAndAge", { items: d.itemCount, age: d.age })}
                amountLabel={d.amountLabel ? `${t("draftListsEstimate")}: ${d.amountLabel}` : null}
                continueLabel={t("draftListsContinue")}
              />
            ))}
          </div>
        </section>
      ) : null}

      {requests.length > 0 ? (
        <div className="kpi-grid">
          <div className="kpi">
            <div className="label">{t("kpiTotal")}</div>
            <div className="value">{requests.length}</div>
            <div className="delta">{t("kpiTotalSub")}</div>
          </div>
          <div className="kpi">
            <div className="label">{t("kpiQuoted")}</div>
            <div className="value">{quotedCount}</div>
            <div className="delta">{t("kpiQuotedSub")}</div>
          </div>
          <div className="kpi">
            <div className="label">{t("kpiDraft")}</div>
            <div className="value">{draftCount}</div>
            <div className="delta">{t("kpiDraftSub")}</div>
          </div>
          <div className="kpi">
            <div className="label">{t("kpiClosed")}</div>
            <div className="value">{acceptedCount}</div>
            <div className="delta">{t("kpiClosedSub")}</div>
          </div>
        </div>
      ) : null}

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("listEyebrow")}</span>
            <h2>{t("listHeading")}</h2>
          </div>
          <Link href="/catalog" className="btn small secondary">
            {t("newRequestCta")}
          </Link>
        </div>

        {requests.length === 0 && drafts.length === 0 ? (
          <EmptyState
            title={t("none")}
            primaryHref="/catalog"
            primaryLabel={tNav("catalog")}
            secondaryHref="/recommend"
            secondaryLabel={tNav("recommend")}
          />
        ) : requests.length === 0 ? (
          <p className="lead muted">{t("draftListsEmptyNote")}</p>
        ) : (
          <div className="action-list">
            {requests.map((r) => (
              <Link
                key={r.id}
                href={`/requests/${r.id}`}
                className="item"
              >
                <StatusBadge value={r.status} />
                <div>
                  <div className="title">{r.plan.name}</div>
                  <div className="sub">
                    {t("itemsAndAge", {
                      items: r.plan.items.length,
                      age: timeAgo(r.createdAt, locale),
                    })}
                    {r.quotes.length > 0 ? ` · ${t("hasQuote")}` : ""}
                  </div>
                </div>
                <span className="chev" aria-hidden>→</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
