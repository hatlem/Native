import { requireDeskContext } from "@/lib/desk-guard";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { conversionPct } from "@/lib/reporting";
import {
  deskRevenueByCurrencySql,
  invoiceStatusTally,
  orderCategoryTally,
  orderStatusTally,
} from "@/lib/desk-report-sql";
import {
  REPORT_PERIOD_PRESETS,
  parseReportPeriod,
  periodDateFilter,
  periodInputDays,
} from "@/lib/report-period";
import {
  benchmarkBy,
  suggestMargin,
  median,
  type BenchmarkRow,
} from "@/lib/pricing-intelligence";
import {
  loadRequestCount,
  loadQuotedRequestCount,
  loadOrderCount,
  loadDecidedQuotes,
  loadBenchProducts,
} from "@/lib/data/desk/reports";

export const dynamic = "force-dynamic";

const DECIDED = ["ACCEPTED", "DECLINED", "EXPIRED"] as const;

export default async function DeskReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  // The desk layout guard alone is not an authorization boundary: the page
  // renders alongside it, so its RSC payload reached non-desk users.
  const ctx = await requireDeskContext(locale);
  const t = await getTranslations({ locale, namespace: "reports" });
  const to = await getTranslations({ locale, namespace: "order" });
  const td = await getTranslations({ locale, namespace: "desk" });
  const tStatus = await getTranslations({ locale, namespace: "status" });
  const statusLabel = (key: string) => (tStatus.has(key) ? tStatus(key) : key);

  // The window everything on this page is counted in, from the URL
  // (lib/report-period.ts) — default the last 12 months.
  const period = parseReportPeriod(await searchParams);
  const created = periodDateFilter(period);
  const inWindow = created ? { createdAt: created } : {};
  const periodDays = periodInputDays(period);

  // Aggregated in the database (lib/desk-report-sql.ts): a few rows back,
  // whatever the order volume.
  const [requestCount, quotedRequestCount, orderCount, revenue, statusRows, categoryRows, invoiceTally] =
    await Promise.all([
      loadRequestCount(ctx, { inWindow }),
      // Requests that reached the quote stage at least once — a relational
      // count (not `status: "QUOTED"`) so a request that later moved on to
      // CLOSED without ordering still counts as having passed through
      // "quoted" for the funnel below.
      // A DRAFT the desk hasn't sent doesn't count as quoted.
      loadQuotedRequestCount(ctx, { inWindow }),
      loadOrderCount(ctx, { inWindow }),
      // GMV and the margin / content-fee split per currency — the rules
      // (cancelled orders out, credit notes off, extra work in, unpriced
      // lines ignored) are pinned in lib/reporting.ts.
      deskRevenueByCurrencySql(period),
      orderStatusTally(period),
      // Cancelled orders' placements never ran: not part of the mix.
      orderCategoryTally(period),
      invoiceStatusTally(period),
    ]);

  // Pricing intelligence: benchmark + suggested margin per category, from
  // decided (won/lost) quote inventory lines.
  const decidedQuotes = await loadDecidedQuotes(ctx, { DECIDED, inWindow });
  const benchProductIds = [
    ...new Set(
      decidedQuotes.flatMap((q) =>
        q.lines.map((l) => l.productId).filter((id): id is string => !!id),
      ),
    ),
  ];
  const benchProducts = benchProductIds.length
    ? await loadBenchProducts(ctx, { benchProductIds })
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

  const kpis = revenue;
  const revenueByCurrency = revenue.filter((r) => r.split.totalRevenue !== 0);
  const invoiceRows = invoiceTally.map((r) => ({ group: r.key, amount: r.count }));

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

      {/* GET form: the period lives in the URL, so a view can be shared. */}
      <form method="get" className="product-form" aria-label={t("periodLabel")}>
        <div className="grid">
          <div className="field">
            <label htmlFor="report-period">{t("periodLabel")}</label>
            <select id="report-period" name="period" defaultValue={period.preset === "custom" ? "" : period.preset}>
              {period.preset === "custom" ? <option value="">{t("periodCustom")}</option> : null}
              {REPORT_PERIOD_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {t(`period_${p}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="report-from">{t("periodFrom")}</label>
            <input id="report-from" type="date" name="from" defaultValue={periodDays.from} />
          </div>
          <div className="field">
            <label htmlFor="report-to">{t("periodTo")}</label>
            <input id="report-to" type="date" name="to" defaultValue={periodDays.to} />
          </div>
        </div>
        <div className="actions">
          <button type="submit" className="btn primary">
            {t("periodApply")}
          </button>
          <span className="muted small">{t("periodHint")}</span>
        </div>
      </form>

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
          <div className="value">{orderCount}</div>
        </div>
        <div className="kpi">
          <div className="label">{t("conversion")}</div>
          <div className="value">{conversionPct(requestCount, orderCount)}%</div>
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
          <BreakdownList rows={statusRows} t={t} kind="count" label={statusLabel} />
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
            {/* Desk-only route; a plain <a> because it's a file download. */}
            <span className="cluster tight">
              <a className="small-link" href="/api/export/invoices.csv" download>
                {t("exportInvoicesCsv")}
              </a>
              {/* The accounting-system export (lines, VAT, customer ids) had
                  no way in from the UI either. */}
              <a className="small-link" href="/api/export/invoices/accounting.json" download>
                {t("exportAccountingJson")}
              </a>
            </span>
          </div>
          <BreakdownList
            rows={invoiceRows.map((r) => ({ key: r.group, count: r.amount }))}
            t={t}
            kind="count"
            label={statusLabel}
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
  label = (k) => k,
}: {
  rows: { key: string; count: number }[];
  t: (k: string) => string;
  kind: "count";
  // Display label for a row key — status enums go through the status
  // namespace instead of rendering raw ("INVOICED").
  label?: (key: string) => string;
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
              <span>{label(r.key)}</span>
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
