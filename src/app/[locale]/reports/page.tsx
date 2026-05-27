import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireOnboardingComplete } from "@/lib/onboarding-gate";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { tally, averageOrderValue } from "@/lib/reporting";
import { EmptyState } from "@/app/empty-state";

export const dynamic = "force-dynamic";

export default async function MyReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "reports" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const session = await auth();

  await requireOnboardingComplete(session, locale);
  const ws = await getWorkspace(session?.user?.id);
  if (!ws) redirect(`/${locale}/signin`);

  const orders = await prisma.order.findMany({
    where: { organizationId: { in: ws.scopeOrgIds } },
    select: {
      status: true,
      quote: { select: { currency: true, total: true } },
      lines: { select: { productId: true } },
    },
  });

  const byCurrency = [...new Set(orders.map((o) => o.quote.currency))].map(
    (cur) => {
      const inCur = orders.filter((o) => o.quote.currency === cur);
      const spend = inCur.reduce((s, o) => s + Number(o.quote.total), 0);
      return {
        currency: cur,
        count: inCur.length,
        spend,
        aov: averageOrderValue(spend, inCur.length),
      };
    },
  );

  const statusRows = tally(orders.map((o) => o.status));

  const productIds = orders.flatMap((o) => o.lines.map((l) => l.productId));
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: { select: { category: true } } },
      })
    : [];
  const catById = new Map(products.map((p) => [p.id, p.title.category]));
  const categoryRows = tally(
    productIds
      .map((id) => catById.get(id))
      .filter((c): c is string => !!c),
  );

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrowOrg")}</span>
        <h1>{t("mySpend")}</h1>
        <p className="lead">{t("mySubtitle")}</p>
      </header>

      {orders.length === 0 ? (
        <EmptyState
          title={t("none")}
          primaryHref="/catalog"
          primaryLabel={tNav("catalog")}
        />
      ) : (
        <>
          <div className="kpi-grid">
            {byCurrency.map((c) => (
              <div className="kpi" key={c.currency}>
                <div className="label">
                  {t("gmv")} · {c.currency}
                </div>
                <div className="value">
                  {formatMoney(c.spend, c.currency, locale)}
                </div>
                <div className="delta">
                  {c.count} {t("orders").toLowerCase()} · {t("aov")}:{" "}
                  {formatMoney(c.aov, c.currency, locale)}
                </div>
              </div>
            ))}
          </div>

          <div className="grid two">
            <section>
              <div className="section-head">
                <h2>{t("byStatus")}</h2>
              </div>
              <BreakdownList rows={statusRows} t={t} />
            </section>
            <section>
              <div className="section-head">
                <h2>{t("byCategory")}</h2>
              </div>
              <BreakdownList rows={categoryRows} t={t} />
            </section>
          </div>
        </>
      )}
    </>
  );
}

function BreakdownList({
  rows,
  t,
}: {
  rows: { key: string; count: number }[];
  t: (k: string) => string;
}) {
  if (rows.length === 0) return <p className="muted">{t("none")}</p>;
  const total = rows.reduce((s, r) => s + r.count, 0) || 1;
  return (
    <div className="breakdown">
      {rows.map((r) => {
        const pct = Math.round((r.count / total) * 100);
        return (
          <div className="breakdown-row" key={r.key}>
            <div className="breakdown-label">
              <span>{r.key}</span>
              <span className="muted small">{r.count}</span>
            </div>
            <div className="breakdown-bar" aria-hidden>
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
