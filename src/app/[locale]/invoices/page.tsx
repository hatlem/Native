import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney, intlLocale } from "@/lib/money";
import { loadScope } from "@/lib/scope";
import { invoiceNumber } from "@/lib/pdf/invoice-pdf-data";
import { EmptyState } from "@/app/empty-state";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

// The buyer's invoices: every invoice for the organizations this session
// may act for (its own org, plus an agency's managed clients). Same scope
// as the requests hub, so a buyer never sees another org's billing.
export default async function InvoicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "invoice" });

  const scope = await loadScope();
  if (!scope.workspace) redirect(`/${locale}/signin`);
  const orgIds = scope.workspace.scopeOrgIds;

  const invoices = await prisma.invoice.findMany({
    where: { organizationId: { in: orgIds } },
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      currency: true,
      total: true,
      issuedAt: true,
      dueAt: true,
      organization: { select: { name: true } },
    },
  });
  // Agencies bill several clients; name the customer only when it varies.
  const showCustomer = orgIds.length > 1;
  const date = (d: Date | null) =>
    d ? new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(d) : "—";

  return (
    <>
      <header className="page-header">
        <h1>{t("listTitle")}</h1>
        <p className="lead">{t("listLead")}</p>
      </header>

      {invoices.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          hint={t("emptyHint")}
          primaryHref="/requests"
          primaryLabel={t("emptyCta")}
        />
      ) : (
        <div className="table-wrap responsive">
          <table className="table">
            <thead>
              <tr>
                <th>{t("number")}</th>
                {showCustomer ? <th>{t("colCustomer")}</th> : null}
                <th>{t("issued")}</th>
                <th>{t("due")}</th>
                <th>{t("status")}</th>
                <th className="num">{t("total")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <Link href={`/invoices/${inv.id}`}>#{invoiceNumber(inv.id)}</Link>
                  </td>
                  {showCustomer ? <td>{inv.organization.name}</td> : null}
                  <td>{date(inv.issuedAt)}</td>
                  <td>{date(inv.dueAt)}</td>
                  <td>
                    <StatusBadge value={inv.status} />
                  </td>
                  <td className="num">{formatMoney(Number(inv.total), inv.currency, locale)}</td>
                  <td>
                    {/* Plain <a>: a route-handler download. */}
                    <a
                      className="small-link"
                      href={`/api/export/invoice-pdf/${inv.id}?locale=${locale}`}
                      download
                    >
                      {t("download")}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
