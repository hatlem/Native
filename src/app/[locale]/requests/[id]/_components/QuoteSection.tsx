import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import {
  buildQuoteNarrative,
  anchorDiscountPct,
} from "@/lib/quote-narrative";
import { acceptAllQuotesForRequest } from "@/app/quote-actions";
import { StatusBadge } from "@/app/status-badge";
import { SectionHead, SubmitButton } from "@/components";
import type {
  OrderWithDetails,
  ProductWithTitle,
  QuoteWithOrder,
} from "./types";

// Quote narrative — per-currency "what you get" blocks, investment
// totals, terms, and the accept CTA (or the accepted banner once every
// quote has an order).
export async function QuoteSection({
  locale,
  quotes,
  products,
  byId,
  organizationName,
  requestId,
  totalQuoteLines,
  allAccepted,
  orders,
}: {
  locale: string;
  quotes: QuoteWithOrder[];
  products: ProductWithTitle[];
  byId: Map<string, ProductWithTitle>;
  organizationName: string;
  requestId: string;
  totalQuoteLines: number;
  allAccepted: boolean;
  orders: OrderWithDetails[];
}) {
  const t = await getTranslations({ locale, namespace: "requests" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tn = await getTranslations({ locale, namespace: "quoteNarrative" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

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
          kind: l.kind,
          productId: l.productId,
          lineTotal: l.lineTotal,
          quantity: l.quantity,
          priceOnRequest: l.priceOnRequest,
        })),
      },
      organization: { name: organizationName },
      productsById: productsForNarrative,
    });
    // Derive the market code from a placement line's product so we
    // can label the per-currency block ("Norway · NOK"). Content-
    // fee lines have no product, so skip them.
    const firstProductId = q.lines.find((l) => l.productId)?.productId;
    const firstProduct = firstProductId
      ? byId.get(firstProductId)
      : undefined;
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
              orgName: organizationName,
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
                              {line.priceOnRequest
                                ? t("priceOnRequest")
                                : formatMoney(
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
                {narrative.lines.some((l) => l.priceOnRequest) ? (
                  <p className="muted small">
                    {t("priceOnRequestNote")}
                  </p>
                ) : null}
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
              value={requestId}
            />
            <SubmitButton
              label={t("accept")}
              pendingLabel={t("accepting")}
              className="btn large"
            />
          </form>
        )}
      </article>
    </section>
  );
}
