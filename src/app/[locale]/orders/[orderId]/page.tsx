import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { safeExternalUrl } from "@/lib/security";
import { StatusBadge } from "@/app/status-badge";
import { duplicatePlan } from "@/app/actions";
import { clicksByOrderLine } from "@/lib/metrics/store";
import { SubmitButton } from "@/components";

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
          brief: {
            include: { assets: { orderBy: { version: "desc" }, take: 1 } },
          },
          booking: { include: { metrics: true } },
        },
      },
    },
  });
  if (!order) notFound();

  const scope = await loadScope();
  if (!canActOnOrg(scope, order.organizationId)) notFound();

  const tperf = await getTranslations({ locale, namespace: "performance" });
  const clickTotals = await clicksByOrderLine(order.lines.map((l) => l.id));

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
        <Link href="/orders" className="small-link">
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
            const latest = line.brief?.assets[0];
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
    </>
  );
}
