import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney, intlLocale } from "@/lib/money";
import { loadScope } from "@/lib/scope";
import { safeExternalUrl } from "@/lib/security";
import { EmptyState } from "@/app/empty-state";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

function timeAgo(date: Date, locale: string): string {
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  if (days >= 1) return rtf.format(-days, "day");
  return rtf.format(0, "day");
}

type SortField = "status" | "organization" | "lines" | "total" | "created";
type SortDir = "asc" | "desc";
const SORT_FIELDS: SortField[] = [
  "status",
  "organization",
  "lines",
  "total",
  "created",
];

function buildOrderBy(field: SortField, dir: SortDir) {
  switch (field) {
    case "status":
      return { status: dir } as const;
    case "organization":
      return { organization: { name: dir } } as const;
    case "lines":
      return { lines: { _count: dir } } as const;
    case "total":
      return { quote: { total: dir } } as const;
    case "created":
      return { createdAt: dir } as const;
  }
}

export default async function MyOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "orders" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const scope = await loadScope();
  if (!scope.workspace) redirect(`/${locale}/signin`);

  const sortRaw = typeof sp.sort === "string" ? sp.sort : "";
  const dirRaw = typeof sp.dir === "string" ? sp.dir : "";
  const sort: SortField = (SORT_FIELDS as readonly string[]).includes(sortRaw)
    ? (sortRaw as SortField)
    : "created";
  const dir: SortDir = dirRaw === "asc" ? "asc" : "desc";

  const orders = await prisma.order.findMany({
    where: { organizationId: { in: scope.workspace.scopeOrgIds } },
    orderBy: buildOrderBy(sort, dir),
    include: {
      organization: { select: { name: true } },
      quote: { select: { currency: true, total: true } },
      invoices: { select: { id: true, status: true } },
      lines: { include: { booking: true } },
    },
  });

  // Toggle direction on the active column, default to desc on a new column.
  const sortHref = (field: SortField) => {
    const nextDir: SortDir = field === sort && dir === "desc" ? "asc" : "desc";
    return `/orders?sort=${field}&dir=${nextDir}`;
  };
  const arrow = (field: SortField) =>
    field === sort ? (dir === "asc" ? " ↑" : " ↓") : "";
  const ariaSort = (field: SortField): "ascending" | "descending" | "none" =>
    field === sort
      ? dir === "asc"
        ? "ascending"
        : "descending"
      : "none";

  const activeCount = orders.filter((o) =>
    ["CONFIRMED", "IN_PRODUCTION", "SCHEDULED"].includes(o.status),
  ).length;
  const liveCount = orders.filter((o) => o.status === "LIVE").length;
  const completedCount = orders.filter((o) => o.status === "COMPLETED").length;

  const totalsByCurrency = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.quote.currency] = (acc[o.quote.currency] ?? 0) + Number(o.quote.total);
    return acc;
  }, {});

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("subtitle")}</p>
      </header>

      {orders.length > 0 ? (
        <div className="kpi-grid">
          <div className="kpi">
            <div className="label">{t("kpiInProgress")}</div>
            <div className="value">{activeCount}</div>
            <div className="delta">{t("kpiInProgressSub")}</div>
          </div>
          <div className="kpi">
            <div className="label">{t("kpiLive")}</div>
            <div className="value">{liveCount}</div>
            <div className="delta">{t("kpiLiveSub")}</div>
          </div>
          <div className="kpi">
            <div className="label">{t("kpiCompleted")}</div>
            <div className="value">{completedCount}</div>
            <div className="delta">{t("kpiCompletedSub")}</div>
          </div>
          <div className="kpi">
            <div className="label">{t("kpiSpend")}</div>
            <div className="value">
              {Object.entries(totalsByCurrency).length === 0
                ? "—"
                : Object.entries(totalsByCurrency).map(([cur, total], i) => (
                    <span key={cur}>
                      {i > 0 ? " · " : ""}
                      {formatMoney(total, cur, locale)}
                    </span>
                  ))}
            </div>
            <div className="delta">{t("kpiSpendSub")}</div>
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
            {t("newOrderCta")}
          </Link>
        </div>

        {orders.length === 0 ? (
          <EmptyState
            title={t("none")}
            primaryHref="/catalog"
            primaryLabel={tNav("catalog")}
          />
        ) : (
          <div className="table-wrap responsive">
            <table className="table">
              <thead>
                <tr>
                  <th aria-sort={ariaSort("status")}>
                    <Link href={sortHref("status")} className="th-sort">
                      {t("status")}
                      {arrow("status")}
                    </Link>
                  </th>
                  <th aria-sort={ariaSort("organization")}>
                    <Link href={sortHref("organization")} className="th-sort">
                      {t("organization")}
                      {arrow("organization")}
                    </Link>
                  </th>
                  <th aria-sort={ariaSort("lines")} className="num">
                    <Link href={sortHref("lines")} className="th-sort">
                      {t("lines")}
                      {arrow("lines")}
                    </Link>
                  </th>
                  <th aria-sort={ariaSort("total")} className="num">
                    <Link href={sortHref("total")} className="th-sort">
                      {t("total")}
                      {arrow("total")}
                    </Link>
                  </th>
                  <th aria-sort={ariaSort("created")}>
                    <Link href={sortHref("created")} className="th-sort">
                      {t("created")}
                      {arrow("created")}
                    </Link>
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const live = safeExternalUrl(
                    o.lines.find((l) => l.booking?.liveUrl)?.booking?.liveUrl,
                  );
                  const invoice = o.invoices[0];
                  return (
                    <tr key={o.id}>
                      <td data-label={t("status")}>
                        <StatusBadge value={o.status} />
                      </td>
                      <td data-label={t("organization")}>
                        <Link href={`/orders/${o.id}`}>{o.organization.name}</Link>
                      </td>
                      <td data-label={t("lines")} className="num">
                        {o.lines.length}
                      </td>
                      <td data-label={t("total")} className="num">
                        {formatMoney(
                          Number(o.quote.total),
                          o.quote.currency,
                          locale,
                        )}
                      </td>
                      <td data-label={t("created")}>
                        {timeAgo(o.createdAt, locale)}
                      </td>
                      <td className="actions-col">
                        <div className="cluster tight">
                          <Link href={`/orders/${o.id}`} className="link">
                            {t("view")}
                          </Link>
                          {invoice ? (
                            <Link
                              href={`/invoices/${invoice.id}`}
                              className="link"
                            >
                              {t("invoice")}
                            </Link>
                          ) : null}
                          {live ? (
                            <a
                              href={live}
                              className="link"
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              {t("livePlacement")}
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
