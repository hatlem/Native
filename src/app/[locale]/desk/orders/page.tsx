import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/app/status-badge";
import { EmptyState } from "@/app/empty-state";

export const dynamic = "force-dynamic";

function timeAgo(date: Date, locale: string): string {
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (days >= 1) return rtf.format(-days, "day");
  return rtf.format(0, "day");
}

export default async function DeskOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "order" });
  const td = await getTranslations({ locale, namespace: "desk" });

  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      organization: true,
      quote: { select: { currency: true, total: true } },
      _count: { select: { lines: true } },
    },
  });

  const inProgress = orders.filter((o) =>
    ["CONFIRMED", "IN_PRODUCTION", "SCHEDULED"].includes(o.status),
  ).length;
  const live = orders.filter((o) => o.status === "LIVE").length;
  const completed = orders.filter((o) => o.status === "COMPLETED").length;

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/desk" className="small-link">
          ← {td("title")}
        </Link>
      </nav>

      <header className="page-header">
        <span className="eyebrow accent">{td("eyebrow")}</span>
        <h1>{t("orders")}</h1>
        <p className="lead">{t("deskLead")}</p>
      </header>

      {orders.length > 0 ? (
        <div className="kpi-grid">
          <div className="kpi">
            <div className="label">{t("kpiInProgress")}</div>
            <div className="value">{inProgress}</div>
          </div>
          <div className="kpi">
            <div className="label">{t("kpiLive")}</div>
            <div className="value">{live}</div>
          </div>
          <div className="kpi">
            <div className="label">{t("kpiCompleted")}</div>
            <div className="value">{completed}</div>
          </div>
        </div>
      ) : null}

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("listEyebrow")}</span>
            <h2>{t("listHeading")}</h2>
          </div>
          <span className="muted small">{t("totalCount", { count: orders.length })}</span>
        </div>

        {orders.length === 0 ? (
          <EmptyState
            title={t("noOrders")}
            primaryHref="/desk"
            primaryLabel={td("title")}
          />
        ) : (
          <div className="table-wrap responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("status")}</th>
                  <th>{t("customer")}</th>
                  <th className="num">{t("lines")}</th>
                  <th className="num">{t("total")}</th>
                  <th>{t("created")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td data-label={t("status")}>
                      <StatusBadge value={o.status} />
                    </td>
                    <td data-label={t("customer")}>
                      <Link href={`/desk/orders/${o.id}`}>{o.organization.name}</Link>
                    </td>
                    <td data-label={t("lines")} className="num">
                      {o._count.lines}
                    </td>
                    <td data-label={t("total")} className="num">
                      {formatMoney(Number(o.quote.total), o.quote.currency, locale)}
                    </td>
                    <td data-label={t("created")}>{timeAgo(o.createdAt, locale)}</td>
                    <td className="actions-col">
                      <Link href={`/desk/orders/${o.id}`} className="link">
                        {t("open")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
