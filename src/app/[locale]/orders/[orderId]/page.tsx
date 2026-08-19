import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney, intlLocale } from "@/lib/money";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { safeExternalUrl } from "@/lib/security";
import { StatusBadge } from "@/app/status-badge";
import { duplicatePlan } from "@/app/plan-actions";
import { clicksByOrderLine } from "@/lib/metrics/store";
import { ctrPct } from "@/lib/reporting";
import { SubmitButton } from "@/components";
import { approveContentAsset, requestContentChanges } from "@/app/content-review-actions";

export const dynamic = "force-dynamic";

export default async function MyOrderPage({
  params,
}: {
  params: Promise<{ locale: string; orderId: string }>;
}) {
  const { locale, orderId } = await params;
  const t = await getTranslations({ locale, namespace: "orders" });
  const to = await getTranslations({ locale, namespace: "order" });
  const tp = await getTranslations({ locale, namespace: "production" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const ti = await getTranslations({ locale, namespace: "invoice" });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      quote: true,
      invoices: { select: { id: true, status: true } },
      lines: {
        include: {
          article: {
            include: { versions: { orderBy: { version: "desc" }, take: 1 } },
          },
          booking: {
              include: {
                metrics: true,
                publisher: { select: { name: true } },
                title: { select: { name: true } },
              },
            },
        },
      },
    },
  });
  if (!order) notFound();

  const scope = await loadScope();
  if (!canActOnOrg(scope, order.organizationId)) notFound();

  const tperf = await getTranslations({ locale, namespace: "performance" });
  const tcr = await getTranslations({ locale, namespace: "campaignReport" });
  const clickTotals = await clicksByOrderLine(order.lines.map((l) => l.id));

  // Campaign report rows — frozen numbers first, live-to-date fallback.
  // Never exposes unitCost, marginPct, or any internal margin field.
  const campaignRows = order.lines.flatMap((l) => {
    const b = l.booking;
    if (!b) return [];
    const firstParty = b.metrics?.clicksFirstPartyAtClose ?? clickTotals[l.id] ?? 0;
    const impressions = b.metrics?.impressionsAtClose ?? b.metrics?.impressions ?? null;
    return [{
      publisher: b.publisher?.name ?? "—",
      title: b.title?.name ?? "—",
      liveStart: b.liveStartDate,
      liveEnd: b.liveEndDate,
      impressions,
      firstPartyClicks: firstParty,
      pageViews: b.metrics?.pageViews ?? null,
      ctr: ctrPct(firstParty, impressions),
      frozen: !!b.metrics?.frozenAt,
    }];
  });
  const reportedCount = campaignRows.filter((r) => r.impressions !== null).length;

  const fmtDate = (d: Date | null) =>
    d ? d.toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short", year: "numeric" }) : "—";
  const fmtNum = (n: number | null) =>
    n === null ? null : n.toLocaleString(intlLocale(locale));

  const products = await prisma.product.findMany({
    where: {
      id: {
        in: order.lines
          .map((l) => l.productId)
          .filter((id): id is string => !!id),
      },
    },
    include: { title: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const invoice = order.invoices[0];

  return (
    <>
      <nav className="breadcrumb">
        {/* /orders (list) permanently redirects to /requests ("Quotes &
            orders") — link straight there instead of bouncing through it. */}
        <Link href="/requests" className="small-link">
          ← {t("title")}
        </Link>
      </nav>

      <header className="detail-head">
        <div>
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>
            {to("title")} #{order.id.slice(-8).toUpperCase()}
          </h1>
          <p className="lead">{t("orderDetailLead")}</p>
        </div>
        <aside className="detail-meta">
          <div className="meta-row">
            <span className="muted small">{to("status")}</span>
            <span className="value">
              <StatusBadge value={order.status} />
            </span>
          </div>
          <div className="meta-row">
            <span className="muted small">{t("lines")}</span>
            <span className="value">{order.lines.length}</span>
          </div>
          <div className="meta-row">
            <span className="muted small">{t("total")}</span>
            <span className="value">
              {formatMoney(
                Number(order.quote.total),
                order.quote.currency,
                locale,
              )}
            </span>
          </div>
          {invoice ? (
            <Link
              href={`/invoices/${invoice.id}`}
              className="btn small secondary"
            >
              {ti("title")} →
            </Link>
          ) : null}
          {/* Returning-customer affordance (Maja R2): rebuild the
              in-flight basket from this order's original plan. The
              user lands on /plan to edit titles, dates, and budget
              before re-submitting the RFQ. */}
          <form action={duplicatePlan}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={order.id} />
            <SubmitButton
              label={t("useAsTemplate")}
              pendingLabel={t("duplicating")}
              className="btn small secondary block"
            />
          </form>
        </aside>
      </header>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("linesEyebrow")}</span>
            <h2>{to("lines")}</h2>
          </div>
        </div>
        <div className="grid two">
          {order.lines.map((line) => {
            const p = line.productId ? byId.get(line.productId) : undefined;
            const isContentFee = line.kind === "CONTENT_FEE";
            const latest = line.article?.versions[0];
            return (
              <article className="card line-card" key={line.id}>
                <div className="line-head">
                  <div>
                    <h3>
                      {p?.title.name ??
                        (isContentFee ? tType("CONTENT_FEE") : "—")}
                    </h3>
                    <p className="muted small">
                      {p ? tType(p.type) : ""}
                    </p>
                  </div>
                  <div className="price" style={{ marginTop: 0 }}>
                    {formatMoney(
                      Number(line.lineTotal),
                      order.quote.currency,
                      locale,
                    )}
                  </div>
                </div>

                <dl className="spec-grid">
                  <dt>{tp("status")}</dt>
                  <dd>
                    {latest ? (
                      <span className="cluster tight">
                        <StatusBadge value={latest.status} />
                        {latest.specPassed === true ? (
                          <span className="badge badge-success dotless">
                            ✓
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="muted small">{tp("noAssets")}</span>
                    )}
                  </dd>
                  {line.booking ? (
                    <>
                      <dt>{t("booking")}</dt>
                      <dd>
                        <StatusBadge value={line.booking.status} />
                      </dd>
                    </>
                  ) : null}
                </dl>

                {(() => {
                  const safe = safeExternalUrl(line.booking?.liveUrl);
                  return safe ? (
                    <a
                      href={safe}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn small secondary block"
                    >
                      {t("livePlacement")} ↗
                    </a>
                  ) : null;
                })()}

                {latest && latest.status === "IN_REVIEW" ? (
                  <div className="content-review">
                    <h4 className="content-review__heading">{t("draftReviewHeading")}</h4>
                    {latest.body ? (
                      <div className="content-review__body">{latest.body}</div>
                    ) : latest.bodyUrl ? (
                      <a
                        href={latest.bodyUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="link small"
                      >
                        {t("draftReviewOpenFile")} ↗
                      </a>
                    ) : null}
                    <div className="content-review__actions">
                      <form action={approveContentAsset}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="assetId" value={latest.id} />
                        <SubmitButton
                          label={t("draftApprove")}
                          pendingLabel={t("draftApproving")}
                          className="btn small"
                        />
                      </form>
                      <details className="content-review__changes">
                        <summary className="btn small secondary content-review__changes-toggle">
                          {t("draftRequestChanges")}
                        </summary>
                        <form action={requestContentChanges} className="content-review__changes-form">
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="assetId" value={latest.id} />
                          <textarea
                            name="note"
                            rows={3}
                            placeholder={t("draftChangesPlaceholder")}
                            required
                          />
                          <SubmitButton
                            label={t("draftSendChanges")}
                            pendingLabel={t("draftApproving")}
                            className="btn small secondary"
                          />
                        </form>
                      </details>
                    </div>
                  </div>
                ) : latest && latest.status === "CHANGES_REQUESTED" && latest.reviewNotes ? (
                  <div className="content-review content-review--sent">
                    <span className="muted small">{t("draftChangesSentNote")}</span>
                    <p className="content-review__note">“{latest.reviewNotes}”</p>
                  </div>
                ) : null}

                {!isContentFee ? (
                  <dl className="spec-grid perf-panel">
                    <dt>{tperf("clicks")}</dt>
                    <dd>{clickTotals[line.id] ?? 0}</dd>
                    {line.booking?.metrics?.impressions != null ? (
                      <>
                        <dt>{tperf("impressions")}</dt>
                        <dd>{line.booking.metrics.impressions.toLocaleString()}</dd>
                      </>
                    ) : (
                      <>
                        <dt>{tperf("panelTitle")}</dt>
                        <dd className="muted small">{tperf("pending")}</dd>
                      </>
                    )}
                  </dl>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {campaignRows.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">{tcr("eyebrow")}</span>
              <h2>{tcr("heading")}</h2>
              <p className="muted small">{tcr("lead")}</p>
            </div>
            <a
              href={`/api/export/campaign-report/${order.id}`}
              className="btn small secondary"
              download
            >
              {tcr("downloadCsv")}
            </a>
          </div>

          {(order.flightStartDate || order.flightEndDate) && (
            <p className="muted small" style={{ marginBottom: "1rem" }}>
              {tcr("flightWindow")}:{" "}
              <strong>
                {fmtDate(order.flightStartDate)} – {fmtDate(order.flightEndDate)}
              </strong>
            </p>
          )}

          <div className="table-wrap" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{tcr("colPublisher")}</th>
                  <th>{tcr("colTitle")}</th>
                  <th>{tcr("colLiveWindow")}</th>
                  <th className="num">{tcr("colImpressions")}</th>
                  <th className="num">{tcr("colClicks")}</th>
                  <th className="num">{tcr("colPageViews")}</th>
                  <th className="num">{tcr("colCtr")}</th>
                </tr>
              </thead>
              <tbody>
                {campaignRows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.publisher}</td>
                    <td>{row.title}</td>
                    <td className="small muted">
                      {row.liveStart || row.liveEnd
                        ? `${fmtDate(row.liveStart)} – ${fmtDate(row.liveEnd)}`
                        : "—"}
                    </td>
                    <td className="num">
                      {row.impressions !== null ? (
                        <span>
                          {fmtNum(row.impressions)}{" "}
                          <span
                            className="badge badge-muted dotless small"
                            title={row.frozen ? tcr("frozen") : tcr("liveToDated")}
                          >
                            {row.frozen ? "✓" : "~"}
                          </span>
                        </span>
                      ) : (
                        <span className="muted small">{tcr("pending")}</span>
                      )}
                    </td>
                    <td className="num">{fmtNum(row.firstPartyClicks) ?? "0"}</td>
                    <td className="num">{fmtNum(row.pageViews) ?? "—"}</td>
                    <td className="num">
                      {row.ctr !== null ? `${row.ctr}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              {campaignRows.length > 1 && (
                <tfoot>
                  <tr className="total-row">
                    <td colSpan={3}>
                      <strong>{tcr("totalRow")}</strong>
                    </td>
                    <td className="num">
                      <strong>
                        {(() => {
                          const total = campaignRows.reduce(
                            (s, r) => (r.impressions !== null ? s + r.impressions : s),
                            0,
                          );
                          return reportedCount > 0 ? fmtNum(total) : "—";
                        })()}
                      </strong>
                    </td>
                    <td className="num">
                      <strong>
                        {fmtNum(
                          campaignRows.reduce((s, r) => s + r.firstPartyClicks, 0),
                        )}
                      </strong>
                    </td>
                    <td className="num">
                      <strong>
                        {(() => {
                          const total = campaignRows.reduce(
                            (s, r) => (r.pageViews !== null ? s + r.pageViews : s),
                            0,
                          );
                          const anyPv = campaignRows.some((r) => r.pageViews !== null);
                          return anyPv ? fmtNum(total) : "—";
                        })()}
                      </strong>
                    </td>
                    <td className="num">
                      {(() => {
                        const totalImpressions = campaignRows.reduce(
                          (s, r) => (r.impressions !== null ? s + r.impressions : s),
                          0,
                        );
                        const totalClicks = campaignRows.reduce(
                          (s, r) => s + r.firstPartyClicks,
                          0,
                        );
                        const totalCtr = ctrPct(totalClicks, totalImpressions > 0 ? totalImpressions : null);
                        return totalCtr !== null ? <strong>{totalCtr}%</strong> : "—";
                      })()}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {reportedCount < campaignRows.length && (
            <p className="muted small" style={{ marginTop: "0.75rem" }}>
              {tcr("coverageCaveat", { n: reportedCount, m: campaignRows.length })}
            </p>
          )}

          <p className="muted small" style={{ marginTop: "0.5rem" }}>
            {tcr("reachDisclaimer")}
          </p>
        </section>
      )}
    </>
  );
}
