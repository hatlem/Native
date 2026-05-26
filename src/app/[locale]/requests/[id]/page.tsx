import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { DataLayerEvent } from "@/app/data-layer-event";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import {
  buildQuoteNarrative,
  anchorDiscountPct,
} from "@/lib/quote-narrative";
import { acceptAllQuotesForRequest } from "@/app/actions";
import { StatusBadge } from "@/app/status-badge";
import {
  Breadcrumb,
  DetailHead,
  MetaRow,
  SectionHead,
} from "@/components";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "requests" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tp = await getTranslations({ locale, namespace: "production" });
  const ti = await getTranslations({ locale, namespace: "invoice" });
  const tn = await getTranslations({ locale, namespace: "quoteNarrative" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  const request = await prisma.request.findUnique({
    where: { id },
    include: {
      organization: true,
      plan: { include: { items: true } },
      quotes: {
        orderBy: { createdAt: "desc" },
        include: {
          lines: true,
          order: {
            include: {
              invoices: true,
              lines: {
                include: {
                  brief: {
                    include: {
                      assets: { orderBy: { version: "desc" }, take: 1 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!request) notFound();

  const session = await auth();
  const role = session?.user?.role;
  const isDesk = role === "DESK" || role === "SUPERADMIN";
  if (!isDesk) {
    const ws = await getWorkspace(session?.user?.id);
    if (!ws?.scopeOrgIds.includes(request.organizationId)) {
      notFound();
    }
  }

  const products = await prisma.product.findMany({
    where: { id: { in: request.plan.items.map((i) => i.productId) } },
    include: { title: { include: { market: true } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // Multi-currency requests carry one Quote per placement market.
  // Sort by currency so the buyer reads them in a stable order across
  // page loads (alphabetical by ISO code).
  const quotes = [...request.quotes].sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );
  const orders = quotes.flatMap((q) => (q.order ? [q.order] : []));
  const allAccepted = quotes.length > 0 && orders.length === quotes.length;
  const orderInvoice = orders[0]?.invoices[0];

  // Aggregate item count across quotes for the campaign-banner outcome
  // line ("3 editorial-grade native placements" rather than per-quote).
  const totalQuoteLines = quotes.reduce((s, q) => s + q.lines.length, 0);

  return (
    <>
      <Breadcrumb href="/requests">{t("listTitle")}</Breadcrumb>

      <DataLayerEvent event="rfq_submitted" id={request.id} />
      {orders.map((o) => {
        const q = quotes.find((x) => x.order?.id === o.id)!;
        return (
          <DataLayerEvent
            key={o.id}
            event="order_confirmed"
            id={o.id}
            value={Number(q.total)}
            currency={q.currency}
          />
        );
      })}

      <DetailHead
        eyebrow={t("eyebrow")}
        title={`${t("title")} · ${request.organization.name}`}
        lead={request.plan.name}
        meta={
          <>
            <MetaRow label={t("status")}>
              <StatusBadge value={request.status} />
            </MetaRow>
            <MetaRow label={t("items")}>{request.plan.items.length}</MetaRow>
            {quotes.length > 0 ? (
              <MetaRow label={t("total")}>
                {quotes
                  .map((q) =>
                    formatMoney(Number(q.total), q.currency, locale),
                  )
                  .join(" + ")}
              </MetaRow>
            ) : null}
          </>
        }
      />

      <section className="section">
        <SectionHead eyebrow={t("itemsEyebrow")} title={t("items")} />
        <div className="grid">
          {request.plan.items.map((item) => {
            const p = byId.get(item.productId);
            return (
              <article className="card" key={item.id}>
                <h3>{p?.title.name ?? item.productId}</h3>
                <p className="muted">{p ? tType(p.type) : ""}</p>
                <span className="tag">× {item.quantity}</span>
              </article>
            );
          })}
        </div>
      </section>

      {quotes.length === 0 ? (
        <section className="section">
          <div className="empty">
            <div className="empty-icon">⏳</div>
            <h3 className="empty-title">{t("pendingTitle")}</h3>
            <p>{t("pending")}</p>
          </div>
        </section>
      ) : (
        (() => {
          // One narrative per quote — anchors, bullets and line totals
          // stay scoped to a single currency.
          const productsForNarrative = new Map(
            products.map((p) => [
              p.id,
              {
                type: p.type,
                title: {
                  name: p.title.name,
                  publishedRateCard: p.title.publishedRateCard,
                  publishedRateCurrency: p.title.publishedRateCurrency,
                },
              },
            ]),
          );
          const quoteViews = quotes.map((q) => {
            const narrative = buildQuoteNarrative({
              quote: {
                currency: q.currency,
                lines: q.lines.map((l) => ({
                  id: l.id,
                  productId: l.productId,
                  lineTotal: l.lineTotal,
                  quantity: l.quantity,
                })),
              },
              organization: { name: request.organization.name },
              productsById: productsForNarrative,
            });
            // Derive the market code from any line's product so we can
            // label the per-currency block ("Norway · NOK").
            const firstProduct =
              q.lines[0] && byId.get(q.lines[0].productId);
            const marketCode = firstProduct?.title.market.code ?? "";
            return { quote: q, narrative, marketCode };
          });
          const earliestValidUntil = quotes
            .map((q) => q.validUntil)
            .filter((d): d is Date => !!d)
            .sort((a, b) => a.getTime() - b.getTime())[0];
          return (
            <section className="section">
              <SectionHead
                eyebrow={t("quoteEyebrow")}
                title={t("quote")}
                trailing={
                  earliestValidUntil ? (
                    <span className="muted small">
                      {t("validUntil")}:{" "}
                      {earliestValidUntil.toISOString().slice(0, 10)}
                    </span>
                  ) : null
                }
              />
              <article className="card quote-narrative">
                <header className="qn-campaign">
                  <span className="eyebrow">{tn("sectionCampaign")}</span>
                  <p className="lead">
                    {tn("outcomeSummary", {
                      orgName: request.organization.name,
                      itemCount: totalQuoteLines,
                    })}
                  </p>
                </header>

                {quoteViews.map(({ quote: q, narrative, marketCode }) => {
                  const vatAmount =
                    Number(q.total) - Number(q.subtotal);
                  return (
                    <div key={q.id}>
                      <div className="qn-block">
                        <span className="eyebrow">
                          {tn("sectionWhatYouGet")}
                          {quotes.length > 1 && marketCode
                            ? ` · ${tMarket(marketCode)} (${q.currency})`
                            : ""}
                        </span>
                        <div className="qn-lines">
                          {narrative.lines.map((line) => {
                            const bullets = tn.raw(
                              `bullets.${line.productType}`,
                            ) as unknown;
                            const items = Array.isArray(bullets)
                              ? (bullets as string[]).map((b) =>
                                  b.replaceAll(
                                    "{titleName}",
                                    line.titleName,
                                  ),
                                )
                              : [];
                            const discount = anchorDiscountPct(line);
                            return (
                              <article
                                className="qn-line"
                                key={line.lineId}
                              >
                                <header>
                                  <div>
                                    <h3>{line.titleName}</h3>
                                    <p className="muted small">
                                      {tType(line.productType)}
                                      {line.quantity > 1
                                        ? ` · × ${line.quantity}`
                                        : ""}
                                    </p>
                                  </div>
                                  <div className="qn-line-price">
                                    {line.anchor ? (
                                      <span className="qn-anchor muted small">
                                        {tn("anchorLabel")}:{" "}
                                        <s>
                                          {formatMoney(
                                            line.anchor.rateCard,
                                            line.anchor.currency,
                                            locale,
                                          )}
                                        </s>
                                        {discount != null ? (
                                          <span className="qn-anchor-savings">
                                            {tn("anchorSavings", {
                                              pct: discount,
                                            })}
                                          </span>
                                        ) : null}
                                      </span>
                                    ) : null}
                                    <span className="qn-line-amount num">
                                      {formatMoney(
                                        line.lineTotal,
                                        q.currency,
                                        locale,
                                      )}
                                    </span>
                                  </div>
                                </header>
                                {items.length > 0 ? (
                                  <ul className="qn-bullets">
                                    {items.map((b, i) => (
                                      <li key={i}>{b}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                        {narrative.lines.some((l) => l.anchor != null) ? (
                          <p className="muted small qn-anchor-note">
                            {tn("anchorNote")}
                          </p>
                        ) : null}
                      </div>

                      <div className="qn-block qn-investment">
                        <span className="eyebrow">
                          {tn("sectionInvestment")}
                          {quotes.length > 1 && marketCode
                            ? ` · ${tMarket(marketCode)} (${q.currency})`
                            : ""}
                        </span>
                        <div className="quote-totals">
                          <div className="quote-row">
                            <span className="muted">{t("subtotal")}</span>
                            <span className="num">
                              {formatMoney(
                                Number(q.subtotal),
                                q.currency,
                                locale,
                              )}
                            </span>
                          </div>
                          <div className="quote-row">
                            <span className="muted">
                              {t("vat")} ({Number(q.vatPct)}%)
                            </span>
                            <span className="num">
                              {formatMoney(vatAmount, q.currency, locale)}
                            </span>
                          </div>
                          <div className="quote-row total">
                            <span>{t("total")}</span>
                            <span className="num">
                              {formatMoney(
                                Number(q.total),
                                q.currency,
                                locale,
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="qn-block qn-why">
                  <span className="eyebrow">{tn("sectionWhyThisPrice")}</span>
                  <p>{tn("whyThisPrice")}</p>
                </div>

                <div className="qn-block qn-terms">
                  <span className="eyebrow">{tn("sectionTerms")}</span>
                  <ul className="qn-terms-list">
                    <li>{tn("termsPayment")}</li>
                    <li>{tn("termsCancellation")}</li>
                    <li>{tn("termsValidity")}</li>
                  </ul>
                </div>

                {allAccepted ? (
                  <div className="banner-success" role="status">
                    ✓ {t("accepted")} — {t("orderStatus")}:{" "}
                    <StatusBadge value={orders[0].status} />
                  </div>
                ) : (
                  <form
                    action={acceptAllQuotesForRequest}
                    className="quote-cta"
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input
                      type="hidden"
                      name="requestId"
                      value={request.id}
                    />
                    <button type="submit" className="btn large">
                      {t("accept")}
                    </button>
                  </form>
                )}
              </article>
            </section>
          );
        })()
      )}

      {orders.length > 0 ? (
        <section className="section">
          <SectionHead
            eyebrow={t("orderEyebrow")}
            title={
              <>
                {t("order")}{" "}
                <StatusBadge value={orders[0].status} />
              </>
            }
            trailing={
              orderInvoice ? (
                <Link
                  href={`/invoices/${orderInvoice.id}`}
                  className="btn small secondary"
                >
                  {ti("title")} →
                </Link>
              ) : null
            }
          />
          <div className="grid">
            {orders.flatMap((o) =>
              o.lines.map((line) => {
                const p = byId.get(line.productId);
                const asset = line.brief?.assets[0];
                return (
                  <article className="card" key={line.id}>
                    <h3>{p?.title.name ?? line.productId}</h3>
                    <p className="muted">{p ? tType(p.type) : ""}</p>
                    <div className="cluster tight">
                      {asset ? (
                        <>
                          <span className="muted small">
                            {tp("status")}:
                          </span>
                          <StatusBadge value={asset.status} />
                          {asset.specPassed === true ? (
                            <span className="badge badge-success dotless">
                              ✓
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="muted small">{tp("noAssets")}</span>
                      )}
                    </div>
                  </article>
                );
              }),
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}
