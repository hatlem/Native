import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { loadScope } from "@/lib/scope";
import { EmptyState } from "@/app/empty-state";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

// Buyer-side order dashboard — PLAN §6 Phase 2 deliverable. Org-scoped
// (an agency sees orders for any of its clients). Counterpart to the
// desk's /desk/orders list.
export default async function MyOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "orders" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const scope = await loadScope();
  if (!scope.workspace) redirect(`/${locale}/signin`);

  const orders = await prisma.order.findMany({
    where: { organizationId: { in: scope.workspace.scopeOrgIds } },
    orderBy: { createdAt: "desc" },
    include: {
      organization: { select: { name: true } },
      quote: { select: { currency: true, total: true } },
      invoices: { select: { id: true, status: true } },
      lines: { include: { booking: true } },
    },
  });

  return (
    <section>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      {orders.length === 0 ? (
        <EmptyState title={t("none")} primaryHref="/catalog" primaryLabel={tNav("catalog")} />
      ) : (
        <div className="grid">
          {orders.map((o) => {
            const live = o.lines.find((l) => l.booking?.liveUrl)?.booking?.liveUrl;
            const invoice = o.invoices[0];
            return (
              <article className="card" key={o.id}>
                <h3>{o.organization.name}</h3>
                <div className="muted">
                  {t("status")}: <StatusBadge value={o.status} />
                </div>
                <div className="muted">
                  {t("lines")}: {o.lines.length}
                </div>
                <div className="price">
                  {formatMoney(Number(o.quote.total), o.quote.currency, locale)}
                </div>
                {live ? (
                  <p className="note">
                    <a href={live} target="_blank" rel="noreferrer noopener">
                      {t("livePlacement")} →
                    </a>
                  </p>
                ) : null}
                <p className="note">
                  <Link href={`/orders/${o.id}`}>{t("view")} →</Link>
                  {invoice ? (
                    <>
                      {" · "}
                      <Link href={`/invoices/${invoice.id}`}>
                        {t("invoice")} <StatusBadge value={invoice.status} />
                      </Link>
                    </>
                  ) : null}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
