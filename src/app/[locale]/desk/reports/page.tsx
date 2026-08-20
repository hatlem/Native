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
import {
  benchmarkBy,
  suggestMargin,
  median,
  type BenchmarkRow,
} from "@/lib/pricing-intelligence";

export const dynamic = "force-dynamic";

const DECIDED = ["ACCEPTED", "DECLINED", "EXPIRED"] as const;

export default async function DeskReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "reports" });
  const to = await getTranslations({ locale, namespace: "order" });
  const td = await getTranslations({ locale, namespace: "desk" });

  const [requestCount, quotedRequestCount, orders, orderLines, markets, invoices] =
    await Promise.all([
      prisma.request.count(),
      // Requests that reached the quote stage at least once — a relational
      // count (not `status: "QUOTED"`) so a request that later moved on to
      // CLOSED without ordering still counts as having passed through
      // "quoted" for the funnel below.
      prisma.request.count({ where: { quotes: { some: {} } } }),
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

  // Pricing intelligence: benchmark + suggested margin per category, from
  // decided (won/lost) quote inventory lines.
  const decidedQuotes = await prisma.quote.findMany({
    where: { status: { in: [...DECIDED] } },
    select: {
      status: true,
      lines: {
        where: { kind: "INVENTORY" },
        select: { productId: true, marginPct: true, lineTotal: true },
      },
    },
  });
  const benchProductIds = [
    ...new Set(
      decidedQuotes.flatMap((q) =>
        q.lines.map((l) => l.productId).filter((id): id is string => !!id),
      ),
    ),
  ];
  const benchProducts = benchProductIds.length
    ? await prisma.product.findMany({
        where: { id: { in: benchProductIds } },
        select: { id: true, title: { select: { category: true } } },
      })
    : [];
  const catByProduct = new Map(
    benchProducts.map((p) => [p.id, p.title.category]),
  );
  const benchRows: BenchmarkRow[] = decidedQuotes.flatMap((q) =>
    q.lines.flatMap((l) => {
      const cat = l.productId ? catByProduct.get(l.productId) : undefined;
      if (!cat) return [];
      return [
        {
          key: cat,
          marginPct: Number(l.marginPct),
          lineTotal: Number(l.lineTotal),
          won: q.status === "ACCEPTED",
        },
      ];
    }),
  );
  const benchmarks = benchmarkBy(benchRows);
  const overallMedianMargin = median(benchRows.map((r) => r.marginPct));
  const pricingIntel = benchmarks.map((b) => {
    const obs = benchRows
      .filter((r) => r.key === b.key)
      .map((r) => ({ marginPct: r.marginPct, won: r.won }));
    const catMedian = median(
      benchRows.filter((r) => r.key === b.key).map((r) => r.marginPct),
    );
    return {
      benchmark: b,
      suggestion: suggestMargin(obs, catMedian ?? overallMedianMargin),
    };
  });

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
          <div className="label">{t("quoted")}</div>
          <div className="value">{quotedRequestCount}</div>
          <div className="delta">
            {conversionPct(requestCount, quotedRequestCount)}% {t("quotedSub")}
          </div>
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

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("pricingIntelEyebrow")}</span>
            <h2>{t("pricingIntel")}</h2>
          </div>
          <span className="muted small">{t("pricingIntelNote")}</span>
        </div>
        {pricingIntel.length === 0 ? (
          <p className="muted">{t("pricingIntelEmpty")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("byCategory")}</th>
                  <th>{t("benchSamples")}</th>
                  <th>{t("benchWinRate")}</th>
                  <th>{t("benchAvgMargin")}</th>
                  <th>{t("suggestedMargin")}</th>
                </tr>
              </thead>
              <tbody>
                {pricingIntel.map(({ benchmark: b, suggestion: s }) => (
                  <tr key={b.key}>
                    <td>{b.key}</td>
                    <td>{b.samples}</td>
                    <td>{b.winRatePct}%</td>
                    <td>{b.avgMarginPct}%</td>
                    <td>
                      <strong>{s.marginPct}%</strong>{" "}
                      <span className="muted small">({t(`basis_${s.basis}`)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
