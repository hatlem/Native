import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import {
  buildQuoteNarrative,
  anchorDiscountPct,
} from "@/lib/quote-narrative";
import { acceptAllQuotesForRequest, requestQuoteRenewal } from "@/app/quote-actions";
import { formatQuoteValidUntil, isQuoteExpired } from "@/lib/commerce/quote-validity";
import { StatusBadge } from "@/app/status-badge";
import { SectionHead, SubmitButton } from "@/components";
import { ViewOnlyNote } from "@/components/view-only-note";
import type {
  OrderWithDetails,
  ProductWithTitle,
  QuoteWithOrder,
  SupersededQuote,
} from "./types";

// Quote narrative — per-currency "what you get" blocks, investment
// totals, terms, and the accept CTA (or the accepted banner once every
// quote has an order, or the "expired — ask for renewal" state once an
// open quote's validity window has closed).
export async function QuoteSection({
  locale,
  timeZone,
  quotes,
  products,
  byId,
  organizationName,
  paymentTermsDays,
  requestId,
  totalQuoteLines,
  allAccepted,
  orders,
  renewalRequested = false,
  canAccept = true,
  canEdit = true,
  supersededQuotes = [],
}: {
  locale: string;
  // The buyer organisation's zone: validity dates are days on its calendar.
  timeZone: string;
  quotes: QuoteWithOrder[];
  products: ProductWithTitle[];
  byId: Map<string, ProductWithTitle>;
  organizationName: string;
  // The customer's agreed payment terms (lib/payment-terms.ts).
  paymentTermsDays: number;
  requestId: string;
  totalQuoteLines: number;
  allAccepted: boolean;
  orders: OrderWithDetails[];
  renewalRequested?: boolean;
  // False for a member without ordering rights: the accept form would only
  // be refused server-side (quote-actions canCommitOnOrg), so say who can act.
  canAccept?: boolean;
  // False for a view-only (RESTRICTED) seat: it reads the quote but can't
  // accept it or ask the desk for a renewal (quote-actions canEditOnOrg).
  canEdit?: boolean;
  // Earlier quotes a sent revision replaced, listed as history.
  supersededQuotes?: SupersededQuote[];
}) {
  const t = await getTranslations({ locale, namespace: "requests" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tn = await getTranslations({ locale, namespace: "quoteNarrative" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tPay = await getTranslations({ locale, namespace: "paymentTerms" });

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
          description: l.description,
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
    const noteByLineId = new Map(
      q.lines.filter((l) => l.customerNote).map((l) => [l.id, l.customerNote as string]),
    );
    return { quote: q, narrative, marketCode, noteByLineId };
  });
  const earliestValidUntil = quotes
    .map((q) => q.validUntil)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  // Accepting is all-or-nothing across markets, so one expired open quote
  // blocks the CTA until the desk renews it.
  const expiredQuotes = allAccepted ? [] : quotes.filter((q) => !q.order && isQuoteExpired(q));
  const expired = expiredQuotes.length > 0;
  const firstLapse = expiredQuotes
    .map((q) => q.validUntil)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const expiredOn = firstLapse ? formatQuoteValidUntil(firstLapse, locale, timeZone) : null;
  const validUntilLabel = earliestValidUntil
    ? formatQuoteValidUntil(earliestValidUntil, locale, timeZone)
    : null;
  // The format's length from the product spec, as it goes into a bullet's
  // "{length}" slot: " (500–900 words)", or nothing when the spec is silent.
  // Hard-coded counts here used to contradict the catalog and writer brief.
  const lengthFor = (productId: string | null): string => {
    const spec = productId ? byId.get(productId)?.spec : null;
    const min = spec?.wordCountMin ?? null;
    const max = spec?.wordCountMax ?? null;
    const words =
      min && max
        ? tn("wordsRange", { min, max })
        : min
          ? tn("wordsMin", { min })
          : max
            ? tn("wordsMax", { max })
            : null;
    return words ? ` (${words})` : "";
  };
  return (
    <section className="section">
      <SectionHead
        eyebrow={t("quoteEyebrow")}
        title={t("quote")}
        trailing={
          validUntilLabel ? (
            <span className="muted small">
              {t("validUntil")}: {validUntilLabel}
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

        {quoteViews.map(({ quote: q, narrative, marketCode, noteByLineId }) => {
          const vatAmount =
            Number(q.total) - Number(q.subtotal);
          return (
            <div key={q.id} id={`quote-${q.id}`}>
              <div className="qn-block">
                <span className="eyebrow">
                  {tn("sectionWhatYouGet")}
                  {quotes.length > 1 && marketCode
                    ? ` · ${tMarket(marketCode)} (${q.currency})`
                    : ""}
                </span>
                {q.revision > 1 ? (
                  <p className="muted small">{t("quoteRevisionNote", { revision: q.revision })}</p>
                ) : null}
                <div className="qn-lines">
                  {narrative.lines.map((line) => {
                    // Curated "what you get" bullets exist only for the
                    // core placement types; a content-fee line (or a
                    // newer type without copy yet) gets none. Guard with
                    // has() — raw() on a missing key logs
                    // MISSING_MESSAGE on every render.
                    const bulletsKey = `bullets.${line.productType}`;
                    const bullets = tn.has(bulletsKey)
                      ? (tn.raw(bulletsKey) as unknown)
                      : null;
                    const length = lengthFor(line.productId);
                    const items = Array.isArray(bullets)
                      ? (bullets as string[]).map((b) =>
                          b
                            .replaceAll("{titleName}", line.titleName)
                            .replaceAll("{length}", length),
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
                        {noteByLineId.get(line.lineId) ? (
                          <p className="line-note__text">
                            <span className="line-note__label">{t("lineNoteLabel")}</span>
                            {noteByLineId.get(line.lineId)}
                          </p>
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
                {/* The offer as a document, for internal approval. Plain
                    <a>: route-handler downloads, rendered on demand, so
                    they never depend on a stored PDF version. */}
                <div className="qn-downloads">
                  <a
                    className="btn small secondary"
                    href={`/api/export/quote-pdf/${q.id}?locale=${locale}`}
                    download
                  >
                    {t("quoteDownloadPdf")}
                  </a>
                  <a
                    className="btn small ghost"
                    href={`/api/export/quote-docx/${q.id}?locale=${locale}`}
                    download
                  >
                    {t("quoteDownloadDocx")}
                  </a>
                </div>
              </div>
            </div>
          );
        })}

        {supersededQuotes.length > 0 ? (
          <div className="qn-block">
            <span className="eyebrow">{t("supersededEyebrow")}</span>
            <ul className="qn-terms-list">
              {supersededQuotes.map((s) => (
                <li key={s.id} className="muted small">
                  {t("supersededRow", {
                    revision: s.revision,
                    total: formatMoney(s.total, s.currency, locale),
                  })}{" "}
                  {s.replacedBy ? (
                    <a href={`#quote-${s.replacedBy.id}`}>
                      {t("supersededBy", { revision: s.replacedBy.revision })}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="qn-block qn-why">
          <span className="eyebrow">{tn("sectionWhyThisPrice")}</span>
          <p>{tn("whyThisPrice")}</p>
        </div>

        <div className="qn-block qn-terms">
          <span className="eyebrow">{tn("sectionTerms")}</span>
          <ul className="qn-terms-list">
            <li>{tPay("line", { days: paymentTermsDays })}</li>
            <li>{tn("termsCancellation")}</li>
            {/* The real deadline, not a fixed "valid for 14 days": the
                desk picks the validity per quote. */}
            <li>
              {validUntilLabel
                ? tn("termsValidUntil", { date: validUntilLabel })
                : tn("termsAvailability")}
            </li>
          </ul>
        </div>

        {allAccepted ? (
          <div className="banner-success" role="status">
            ✓ {t("accepted")} — {t("orderStatus")}:{" "}
            <StatusBadge value={orders[0].status} />
          </div>
        ) : expired ? (
          <div className="quote-expired" role="status">
            <p className="quote-expired__text">
              <strong>
                {expiredOn ? t("quoteExpiredTitle", { date: expiredOn }) : t("quoteExpiredTitleNoDate")}
              </strong>
              {renewalRequested ? t("renewalRequested") : t("quoteExpiredBody")}
            </p>
            {renewalRequested || !canEdit ? null : (
              <form action={requestQuoteRenewal}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="requestId" value={requestId} />
                <SubmitButton
                  label={t("requestRenewal")}
                  pendingLabel={t("requestingRenewal")}
                  className="btn"
                />
              </form>
            )}
          </div>
        ) : !canEdit ? (
          <ViewOnlyNote locale={locale} />
        ) : !canAccept ? (
          <div className="banner-info" role="status">
            <span>
              <strong>{t("noCommitTitle")}</strong> {t("noCommitBody", { org: organizationName })}
            </span>
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
