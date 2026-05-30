import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import {
  tally,
  sumByGroup,
  averageOrderValue,
  conversionPct,
  revenueSplit,
} from "@/lib/reporting";

export const dynamic = "force-dynamic";

export default async function DeskReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "reports" });
  const to = await getTranslations({ locale, namespace: "order" });
  const td = await getTranslations({ locale, namespace: "desk" });

  const [requestCount, orders, orderLines, markets, invoices] =
    await Promise.all([
      prisma.request.count(),
      prisma.order.findMany({
        select: {
          status: true,
          quote: {
            select: {
              currency: true,
              total: true,
              subtotal: true,
              lines: {
                select: {
                  kind: true,
                  unitCost: true,
                  quantity: true,
                  lineTotal: true,
                },
              },
            },
          },
        },
      }),
      prisma.orderLine.findMany({ select: { productId: true } }),
      prisma.market.findMany({ select: { currency: true } }),
      prisma.invoice.findMany({ select: { status: true } }),
    ]);

  const currencies = [...new Set(markets.map((m) => m.currency))];
  const kpis = currencies
    .map((cur) => {
      const inCur = orders.filter((o) => o.quote.currency === cur);
      const gmv = inCur.reduce((s, o) => s + Number(o.quote.total), 0);
      return {
        currency: cur,
        count: inCur.length,
        gmv,
        aov: averageOrderValue(gmv, inCur.length),
      };
    })
    .filter((k) => k.count > 0);

  const statusRows = tally(orders.map((o) => o.status));

  // Revenue split (margin vs content fee) per currency — the "emphasis"
  // view. Computed from realized order quote lines.
  const revenueByCurrency = currencies
    .map((cur) => {
      const lines = orders
        .filter((o) => o.quote.currency === cur)
        .flatMap((o) =>
          o.quote.lines.map((l) => ({
            kind: l.kind,
            unitCost: Number(l.unitCost),
            quantity: l.quantity,
            lineTotal: Number(l.lineTotal),
          })),
        );
      return { currency: cur, split: revenueSplit(lines) };
    })
    .filter((r) => r.split.totalRevenue !== 0);

  const products = orderLines.length
    ? await prisma.product.findMany({
        where: {
          id: {
            in: orderLines
              .map((l) => l.productId)
              .filter((id): id is string => !!id),
          },
        },
        select: { id: true, title: { select: { category: true } } },
      })
    : [];
  const catById = new Map(products.map((p) => [p.id, p.title.category]));
  const categoryRows = tally(
    orderLines
      .map((l) => (l.productId ? catById.get(l.productId) : undefined))
      .filter((c): c is string => !!c),
  );

  const invoiceRows = sumByGroup(
    invoices.map((i) => ({ group: i.status, amount: 1 })),
  );

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/desk" className="small-link">
          ← {td("title")}
        </Link>
      </nav>

      <header className="page-header">
        <span className="eyebrow accent">{td("eyebrow")} · {t("title")}</span>
        <h1>{t("reportsHeadline")}</h1>
        <p className="lead">{t("subtitle")}</p>
      </header>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">{t("requests")}</div>
          <div className="value">{requestCount}</div>
        </div>
        <div className="kpi">
          <div className="label">{to("orders")}</div>
          <div className="value">{orders.length}</div>
        </div>
        <div className="kpi">
          <div className="label">{t("conversion")}</div>
          <div className="value">{conversionPct(requestCount, orders.length)}%</div>
          <div className="delta">{t("conversionSub")}</div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("gmvEyebrow")}</span>
            <h2>{t("gmv")}</h2>
          </div>
          {kpis.length > 0 ? (
            <span className="muted small">{t("gmvNote")}</span>
          ) : null}
        </div>
        {kpis.length === 0 ? (
          <p className="muted">{t("none")}</p>
        ) : (
          <div className="grid">
            {kpis.map((k) => (
              <article className="card" key={k.currency}>
                <span className="tag">{k.currency}</span>
                <h3>{formatMoney(k.gmv, k.currency, locale)}</h3>
                <p className="muted small">
                  {t("orderCount", { count: k.count })}
                </p>
                <p className="muted small">
                  {t("aov")}: {formatMoney(k.aov, k.currency, locale)}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("revenueSplitEyebrow")}</span>
            <h2>{t("revenueSplit")}</h2>
          </div>
          <span className="muted small">{t("revenueSplitNote")}</span>
        </div>
        {revenueByCurrency.length === 0 ? (
          <p className="muted">{t("none")}</p>
        ) : (
          <div className="grid">
            {revenueByCurrency.map(({ currency, split }) => (
              <article className="card" key={currency}>
                <span className="tag">{currency}</span>
                <h3>{formatMoney(split.totalRevenue, currency, locale)}</h3>
                <p className="muted small">
                  {t("marginRevenue")}:{" "}
                  {formatMoney(split.marginRevenue, currency, locale)}
                </p>
                <p className="muted small">
                  {t("contentFeeRevenue")}:{" "}
                  {formatMoney(split.contentFeeRevenue, currency, locale)}
                </p>
                <p className="muted small">
                  {t("contentFeeShare")}: {split.contentFeeRatioPct}%
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="grid two">
        <section>
          <div className="section-head">
            <h2>{t("byStatus")}</h2>
          </div>
          <BreakdownList rows={statusRows} t={t} kind="count" />
        </section>

        <section>
          <div className="section-head">
            <h2>{t("byCategory")}</h2>
          </div>
          <BreakdownList rows={categoryRows} t={t} kind="count" />
        </section>

        <section>
          <div className="section-head">
            <h2>{t("invoices")}</h2>
          </div>
          <BreakdownList
            rows={invoiceRows.map((r) => ({ key: r.group, count: r.amount }))}
            t={t}
            kind="count"
          />
        </section>
      </div>
    </>
  );
}

function BreakdownList({
  rows,
  t,
  kind,
}: {
  rows: { key: string; count: number }[];
  t: (k: string) => string;
  kind: "count";
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
              <span className="muted small">{kind === "count" ? r.count : r.count}</span>
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
