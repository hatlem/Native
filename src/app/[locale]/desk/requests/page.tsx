import { getTranslations } from "next-intl/server";
import { Prisma, RequestStatus } from "@prisma/client";
import { requireDeskContext } from "@/lib/desk-guard";
import { intlLocale } from "@/lib/money";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { EmptyState } from "@/app/empty-state";
import { PageHeader } from "@/components";
import {
  DESK_REQUESTS_PAGE_SIZE,
  parseDeskRequestsQuery,
  deskRequestsHref,
  DESK_REQUEST_STATUSES,
} from "@/lib/desk-requests-query";
import {
  loadTotal,
  loadRequests,
} from "@/lib/data/desk/requests";

export const dynamic = "force-dynamic";

// The full desk request queue. /desk shows only the 8 newest per bucket; this
// is where the ninth-oldest brief (and everything after it) is reachable, with
// the filter, search and page all in the URL so a view can be shared.
export default async function DeskRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const ctx = await requireDeskContext(locale);
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "desk" });
  const ts = await getTranslations({ locale, namespace: "status" });

  const query = parseDeskRequestsQuery(sp);
  const { q, status, page } = query;

  const statusWhere: Prisma.RequestWhereInput =
    status === "open"
      ? { status: { in: ["SUBMITTED", "IN_REVIEW"] } }
      : status === "all"
        ? { status: { not: "DRAFT" } }
        : { status: status as RequestStatus };
  const where: Prisma.RequestWhereInput = {
    ...statusWhere,
    ...(q
      ? {
          OR: [
            { organization: { name: { contains: q, mode: "insensitive" } } },
            { briefSummary: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, requests] = await Promise.all([
    loadTotal(ctx, { where }),
    loadRequests(ctx, { where, status, page }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / DESK_REQUESTS_PAGE_SIZE));
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/desk" className="small-link">
          ← {t("title")}
        </Link>
      </nav>
      <PageHeader eyebrow={t("eyebrow")} title={t("requestsTitle")} lead={t("requestsLead")} />

      <form method="get" className="result-bar">
        <div className="field" style={{ margin: 0, flex: 1 }}>
          <label htmlFor="req-q">{t("requestsSearchLabel")}</label>
          <input id="req-q" name="q" type="search" defaultValue={q} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="req-status">{t("requestsStatusLabel")}</label>
          <select id="req-status" name="status" defaultValue={status}>
            <option value="open">{t("requestsStatusOpen")}</option>
            <option value="all">{t("requestsStatusAll")}</option>
            {DESK_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn secondary">
          {t("requestsSearchButton")}
        </button>
      </form>

      <section className="section">
        <p className="muted small" role="status">
          {t("requestsCount", { count: total })}
        </p>
        {requests.length === 0 ? (
          <EmptyState
            title={t("requestsEmpty")}
            primaryHref="/desk/requests?status=all"
            primaryLabel={t("requestsStatusAll")}
          />
        ) : (
          <div className="table-wrap responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("status")}</th>
                  <th>{t("org")}</th>
                  <th className="num">{t("items")}</th>
                  <th className="num">{t("requestsColQuotes")}</th>
                  <th>{t("requestsColUpdated")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td data-label={t("status")}>
                      <StatusBadge value={r.status} />
                    </td>
                    <td data-label={t("org")}>
                      <Link href={`/desk/${r.id}`}>{r.organization.name}</Link>
                      {r.briefSummary ? (
                        <div className="muted small">
                          {r.briefSummary.slice(0, 100)}
                          {r.briefSummary.length > 100 ? "…" : ""}
                        </div>
                      ) : null}
                    </td>
                    <td data-label={t("items")} className="num">
                      {r.plan._count.items}
                    </td>
                    <td data-label={t("requestsColQuotes")} className="num">
                      {r._count.quotes}
                    </td>
                    <td data-label={t("requestsColUpdated")}>{dateFmt.format(r.updatedAt)}</td>
                    <td className="actions-col">
                      <Link href={`/desk/${r.id}`} className="link">
                        {t("open")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 ? (
          <nav className="pagination" aria-label={t("requestsPaginationLabel")}>
            {page > 1 ? (
              <Link href={deskRequestsHref({ ...query, page: page - 1 })}>← {t("requestsPrev")}</Link>
            ) : null}
            <span className="muted small">{t("requestsPageOf", { page, pages: pageCount })}</span>
            {page < pageCount ? (
              <Link href={deskRequestsHref({ ...query, page: page + 1 })}>{t("requestsNext")} →</Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
