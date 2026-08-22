import { Fragment } from "react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import {
  generateQuote,
  generateQuotePdf,
  setQuoteLinePrice,
} from "@/app/quote-actions";
import { resolvePlanTitleItem, removePlanTitleItem } from "@/app/desk-actions";
import { loadPricingDefaults } from "@/lib/content-fee";
import {
  customerPrice,
  productBand,
  unitRate,
} from "@/lib/pricing/display-price";
import { bandLabel, priceBand } from "@/lib/pricing/bands";
import { StatusBadge } from "@/app/status-badge";
import { SubmitButton } from "@/components";
import { canSeeCostVsSell } from "@/lib/roles";
import { presignDownload } from "@/lib/storage/r2";
import { intlLocale } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function DeskRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; requestId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, requestId } = await params;
  const sp = await searchParams;
  const errorCode = typeof sp.error === "string" ? sp.error : "";
  const t = await getTranslations({ locale, namespace: "desk" });
  const tr = await getTranslations({ locale, namespace: "requests" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  // Cost-vs-sell (unitCost/margin) is publisher-sensitive commercial data —
  // gated to SUPERADMIN only. This page otherwise stays open to any desk
  // role, so we scope the check to the one span that needs it below rather
  // than redirecting the whole page (see desk/titles/[id]/page.tsx for the
  // full-page variant of this same role check).
  const session = await auth();
  const isSuperadmin = canSeeCostVsSell(session?.user?.role);

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      organization: true,
      plan: { include: { items: true } },
      quotes: {
        orderBy: { createdAt: "desc" },
        include: {
          lines: {
            include: {
              priceSetBy: { select: { name: true, email: true } },
            },
          },
          order: true,
          documents: { orderBy: { version: "desc" } },
        },
      },
    },
  });
  if (!request) notFound();

  // Plan items split into product lines and Title placeholders (productId
  // null). Fetch products for the former and bare title names for the
  // latter so the desk sees the full ask without a null in the `in` array.
  const productIds = request.plan.items
    .map((i) => i.productId)
    .filter((id): id is string => !!id);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { title: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // Primary sales contact per title, for the resolve/quote line cards below —
  // the desk works this page to decide what to book, and needs the same
  // "who do I call" answer that currently only lives on /desk/titles/[id].
  // One SalesContact can be primary per title (SalesContactTitle.isPrimary);
  // titleIds is built below, so gather the set from both resolved products
  // and unresolved placeholders up front.
  const allTitleIds = [
    ...new Set([
      ...products.map((p) => p.titleId).filter((id): id is string => !!id),
      ...request.plan.items.map((i) => i.titleId).filter((id): id is string => !!id),
    ]),
  ];
  const primaryContacts = allTitleIds.length
    ? await prisma.salesContactTitle.findMany({
        where: { titleId: { in: allTitleIds }, isPrimary: true },
        select: {
          titleId: true,
          salesContact: { select: { name: true, email: true, phone: true } },
        },
      })
    : [];
  const contactByTitleId = new Map(primaryContacts.map((c) => [c.titleId, c.salesContact]));

  const titleIds = request.plan.items
    .map((i) => i.titleId)
    .filter((id): id is string => !!id);
  const titles = titleIds.length
    ? await prisma.title.findMany({
        where: { id: { in: titleIds } },
        select: { id: true, name: true },
      })
    : [];
  const titleById = new Map(titles.map((t) => [t.id, t]));

  // Bookable placements per placeholder title, for the desk's resolve picker.
  // Each option carries the indicative price band/rate (same helpers the catalog
  // uses) so the desk picks an INFORMED placement, not just a type label. Read-
  // only — the resolve action and its hidden inputs are unchanged.
  const pricing =
    titleIds.length || request.quotes.length ? await loadPricingDefaults() : null;
  const placementProducts = titleIds.length
    ? await prisma.product.findMany({
        where: { titleId: { in: titleIds }, active: true, bookable: true },
        select: {
          id: true,
          type: true,
          titleId: true,
          active: true,
          confirmedAt: true,
          pricingModel: true,
          basePrice: true,
          currency: true,
          productionFee: true,
          priceRules: { select: { marginPct: true, seasonalMultiplier: true, minVolume: true } },
          title: {
            select: {
              pricesPublic: true,
              productionFeeDefault: true,
              market: { select: { code: true } },
              publisher: { select: { pricesPublic: true } },
            },
          },
        },
      })
    : [];
  const placementsByTitle = new Map<string, { id: string; label: string }[]>();
  for (const p of placementProducts) {
    if (!p.titleId || !p.title || !pricing) continue;
    const band = productBand(p, p.title, pricing); // FLAT → Band | null
    const rate = band ? null : unitRate(p, p.title, pricing); // CPM/CPC → {rate,unit} | null
    const priceText = band
      ? `${t("resolveFrom")} ${bandLabel(band, p.currency)}` // "from 25–40k NOK"
      : rate
        ? `≈ ${rate.rate} ${p.currency} ${rate.unit}` // "≈ 395 NOK CPM"
        : null; // unconfirmed / price hidden → bare type label
    const label = priceText ? `${tType(p.type)} — ${priceText}` : tType(p.type);
    const arr = placementsByTitle.get(p.titleId) ?? [];
    arr.push({ id: p.id, label });
    placementsByTitle.set(p.titleId, arr);
  }

  const unresolvedTitleCount = request.plan.items.filter(
    (i) => !i.productId && i.titleId,
  ).length;
  const resolvedItemCount = request.plan.items.filter((i) => i.productId).length;

  // Catalog price reference per quote-line product — the "interval" the
  // desk sees next to the editable price field. Desk-internal: the buyer
  // visibility gate (confirmedAt/pricesPublic) is deliberately bypassed,
  // because the whole point is pricing lines whose catalog price ISN'T
  // buyer-visible yet. Unconfirmed products are labelled as estimates by
  // the UI, not silently presented as firm.
  const quoteLineProductIds = [
    ...new Set(
      request.quotes
        .flatMap((q) => q.lines)
        .map((l) => l.productId)
        .filter((id): id is string => !!id),
    ),
  ];
  const referenceByProductId = new Map<string, string>();
  if (quoteLineProductIds.length && pricing) {
    const refProducts = await prisma.product.findMany({
      where: { id: { in: quoteLineProductIds } },
      select: {
        id: true,
        type: true,
        active: true,
        confirmedAt: true,
        pricingModel: true,
        basePrice: true,
        currency: true,
        productionFee: true,
        priceRules: {
          select: { marginPct: true, seasonalMultiplier: true, minVolume: true },
        },
        title: {
          select: {
            productionFeeDefault: true,
            market: { select: { code: true } },
          },
        },
      },
    });
    for (const p of refProducts) {
      const deskTitle = {
        ...p.title,
        pricesPublic: true,
        publisher: { pricesPublic: true },
      };
      if (!p.pricingModel || p.pricingModel === "FLAT") {
        const band = priceBand(customerPrice(p, deskTitle, pricing), p.currency);
        referenceByProductId.set(p.id, bandLabel(band, p.currency));
      } else {
        const rate = unitRate(
          { ...p, active: true, confirmedAt: p.confirmedAt ?? new Date(0) },
          deskTitle,
          pricing,
        );
        if (rate) {
          referenceByProductId.set(p.id, `≈ ${rate.rate} ${p.currency} ${rate.unit}`);
        }
      }
    }
  }

  // Pre-sign every quote document's download URL up front (server render,
  // short-lived) — same pattern as RateCardsPanel.
  const quotesWithDownloadUrls = await Promise.all(
    request.quotes.map(async (q) => ({
      ...q,
      documents: await Promise.all(
        q.documents.map(async (d) => ({
          ...d,
          url: await presignDownload({ key: d.objectKey }).catch(() => null),
        })),
      ),
    })),
  );

  // Who to actually reach out to for this title — the answer used to live
  // only on /desk/titles/[id], several clicks away from where the desk is
  // deciding what to book.
  function ContactLine({ titleId }: { titleId: string | null | undefined }) {
    const contact = titleId ? contactByTitleId.get(titleId) : undefined;
    if (!contact) return <p className="muted small">{t("salesContactMissing")}</p>;
    return (
      <p className="muted small">
        {contact.name} · <a href={`mailto:${contact.email}`}>{contact.email}</a>
        {contact.phone ? ` · ${contact.phone}` : ""}
      </p>
    );
  }

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/desk" className="small-link">
          ← {t("title")}
        </Link>
      </nav>

      <header className="detail-head">
        <div>
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>
            {t("request")} · {request.organization.name}
          </h1>
          {request.briefSummary ? (
            <p className="lead">{request.briefSummary}</p>
          ) : null}
        </div>
        <aside className="detail-meta">
          <div className="meta-row">
            <span className="muted small">{t("status")}</span>
            <span className="value">
              <StatusBadge value={request.status} />
            </span>
          </div>
          <div className="meta-row">
            <span className="muted small">{t("items")}</span>
            <span className="value">{request.plan.items.length}</span>
          </div>
          {quotesWithDownloadUrls.length === 1 ? (
            <div className="meta-row">
              <span className="muted small">{t("total")}</span>
              <span className="value">
                {formatMoney(
                  Number(quotesWithDownloadUrls[0].total),
                  quotesWithDownloadUrls[0].currency,
                  locale,
                )}
              </span>
            </div>
          ) : null}
        </aside>
      </header>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("briefEyebrow")}</span>
            <h2>{t("items")}</h2>
          </div>
        </div>
        {errorCode === "unresolved-titles" ? (
          <div className="banner-warn" role="alert">
            <span>{t("resolveTitlesFirst", { count: unresolvedTitleCount })}</span>
          </div>
        ) : null}
        <div className="grid">
          {request.plan.items.map((item) => {
            // Title placeholder — no product chosen yet; the desk proposes
            // the concrete placement by picking a product OF THIS TITLE.
            if (!item.productId) {
              const titleName = item.titleId
                ? titleById.get(item.titleId)?.name ?? tr("titlePlaceholderName")
                : tr("titlePlaceholderName");
              const placements = item.titleId
                ? placementsByTitle.get(item.titleId) ?? []
                : [];
              return (
                <article className="card" key={item.id}>
                  <h3>{titleName}</h3>
                  <p className="muted">{tr("titlePlaceholderDesc")}</p>
                  <span className="tag">× {item.quantity}</span>
                  <ContactLine titleId={item.titleId} />
                  {placements.length > 0 ? (
                    <form action={resolvePlanTitleItem} className="resolve-line">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="requestId" value={request.id} />
                      <input type="hidden" name="planItemId" value={item.id} />
                      <select name="productId" defaultValue="" aria-label={t("resolvePlacement")}>
                        <option value="" disabled>
                          {t("resolvePlacement")}
                        </option>
                        {placements.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn small">
                        {t("resolveUse")}
                      </button>
                    </form>
                  ) : (
                    <p className="muted small">{t("resolveNoPlacements")}</p>
                  )}
                  {/* Recovery: drop a placeholder that can't be resolved (e.g.
                      the title has no bookable placement) so the request isn't
                      stuck unquotable. Only unresolved placeholders are droppable. */}
                  <form action={removePlanTitleItem} className="resolve-line">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="planItemId" value={item.id} />
                    <button type="submit" className="btn small ghost">
                      {t("resolveRemove")}
                    </button>
                  </form>
                </article>
              );
            }
            const p = byId.get(item.productId);
            return (
              <article className="card" key={item.id}>
                <h3>{p?.title.name ?? item.productId}</h3>
                <p className="muted">{p ? tType(p.type) : ""}</p>
                <span className="tag">× {item.quantity}</span>
                <ContactLine titleId={p?.titleId} />
              </article>
            );
          })}
        </div>
      </section>

      {quotesWithDownloadUrls.length === 0 ? (
        <section className="section">
          <div className="cta-block">
            <h2>{t("readyToQuoteTitle")}</h2>
            {resolvedItemCount === 0 ? (
              // Nothing quotable yet — every placement is still a placeholder.
              <p className="muted">{t("resolveTitlesFirst", { count: unresolvedTitleCount })}</p>
            ) : (
              <>
                <p className="muted">{t("readyToQuoteBody")}</p>
                {unresolvedTitleCount > 0 ? (
                  <p className="muted small">
                    {t("readyToQuotePartial", {
                      priced: resolvedItemCount,
                      pending: unresolvedTitleCount,
                    })}
                  </p>
                ) : null}
                <form action={generateQuote}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="requestId" value={request.id} />
                  <SubmitButton
                    label={t("generate")}
                    pendingLabel={t("generating")}
                    className="btn large"
                  />
                </form>
              </>
            )}
          </div>
        </section>
      ) : (
        quotesWithDownloadUrls.map((quote) => (
          <section className="section" key={quote.id}>
            <div className="section-head">
              <div>
                <span className="eyebrow">{t("quoteEyebrow")}</span>
                <h2>{t("pdfQuoteLabel", { currency: quote.currency })}</h2>
              </div>
              {quote.order ? (
                <Link
                  href={`/desk/orders/${quote.order.id}`}
                  className="btn small secondary"
                >
                  {t("openOrder")} →
                </Link>
              ) : null}
            </div>
            <article className="card quote-card">
              {errorCode === "bad-price" ? (
                <div className="banner-warn" role="alert">
                  <span>{t("linePriceInvalid")}</span>
                </div>
              ) : null}
              <p className="muted small">
                {t("lineStateSummary", {
                  priced: quote.lines.filter((l) => !l.priceOnRequest).length,
                  onRequest: quote.lines.filter((l) => l.priceOnRequest).length,
                })}
              </p>
              <div className="quote-lines">
                {quote.lines.map((l) => {
                  const reference = l.productId
                    ? referenceByProductId.get(l.productId)
                    : undefined;
                  const editable = !quote.order;
                  return (
                    <Fragment key={l.id}>
                      <div className="quote-line">
                        <span>
                          {l.description}{" "}
                          <span className="muted">
                            × {l.quantity}
                            {l.priceOnRequest
                              ? ""
                              : ` · margin ${Number(l.marginPct)}%`}
                          </span>
                        </span>
                        <span className="num">
                          {l.priceOnRequest ? (
                            <span className="tag">{t("linePriceOnRequest")}</span>
                          ) : (
                            formatMoney(Number(l.lineTotal), quote.currency, locale)
                          )}
                        </span>
                      </div>
                      {reference ? (
                        <div className="muted small">
                          {t("linePriceReference", { reference })}
                        </div>
                      ) : null}
                      {l.priceSetAt ? (
                        <div className="muted small">
                          {t("linePriceSetBy", {
                            name:
                              l.priceSetBy?.name ??
                              l.priceSetBy?.email ??
                              t("linePriceSetByUnknown"),
                            date: new Intl.DateTimeFormat(intlLocale(locale), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(l.priceSetAt),
                          })}
                        </div>
                      ) : null}
                      {isSuperadmin && !l.priceOnRequest ? (
                        <div className="muted small">
                          {t("costVsSell", {
                            cost: formatMoney(
                              Number(l.unitCost) * l.quantity,
                              quote.currency,
                              locale,
                            ),
                            sell: formatMoney(
                              Number(l.lineTotal),
                              quote.currency,
                              locale,
                            ),
                          })}
                        </div>
                      ) : null}
                      {editable ? (
                        <div className="resolve-line">
                          <form action={setQuoteLinePrice} className="resolve-line">
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="requestId" value={request.id} />
                            <input type="hidden" name="quoteId" value={quote.id} />
                            <input type="hidden" name="lineId" value={l.id} />
                            <input type="hidden" name="intent" value="set" />
                            <input
                              type="text"
                              name="lineTotal"
                              inputMode="decimal"
                              placeholder={t("linePricePlaceholder", {
                                currency: quote.currency,
                              })}
                              aria-label={t("linePricePlaceholder", {
                                currency: quote.currency,
                              })}
                            />
                            <button type="submit" className="btn small">
                              {t("linePriceSave")}
                            </button>
                          </form>
                          {!l.priceOnRequest ? (
                            <form action={setQuoteLinePrice}>
                              <input type="hidden" name="locale" value={locale} />
                              <input
                                type="hidden"
                                name="requestId"
                                value={request.id}
                              />
                              <input type="hidden" name="quoteId" value={quote.id} />
                              <input type="hidden" name="lineId" value={l.id} />
                              <input type="hidden" name="intent" value="onRequest" />
                              <button type="submit" className="btn small ghost">
                                {t("linePriceMarkOnRequest")}
                              </button>
                            </form>
                          ) : null}
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
              <div className="quote-totals">
                <div className="quote-row">
                  <span className="muted">{t("subtotal")}</span>
                  <span className="num">
                    {formatMoney(Number(quote.subtotal), quote.currency, locale)}
                  </span>
                </div>
                <div className="quote-row">
                  <span className="muted">
                    {t("vat")} ({Number(quote.vatPct)}%)
                  </span>
                  <span className="num">
                    {formatMoney(
                      Number(quote.total) - Number(quote.subtotal),
                      quote.currency,
                      locale,
                    )}
                  </span>
                </div>
                <div className="quote-row total">
                  <span>{t("total")}</span>
                  <span className="num">
                    {formatMoney(Number(quote.total), quote.currency, locale)}
                  </span>
                </div>
              </div>
              {quote.order ? (
                <div className="banner-success" role="status">
                  ✓ {t("acceptedOrder")}
                </div>
              ) : (
                <div className="quote-cta">
                  <span className="muted small">{t("awaiting")}</span>
                </div>
              )}
              <div className="quote-pdf-section">
                <h3>{t("pdfSection")}</h3>
                {quote.documents.length === 0 ? (
                  <p className="muted small">{t("pdfNone")}</p>
                ) : (
                  <ul className="quote-pdf-versions">
                    {quote.documents.map((d) => (
                      <li key={d.id}>
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer">
                            {t("pdfVersionRow", {
                              version: d.version,
                              date: new Intl.DateTimeFormat(intlLocale(locale), {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }).format(d.generatedAt),
                            })}
                          </a>
                        ) : (
                          t("pdfVersionRow", {
                            version: d.version,
                            date: new Intl.DateTimeFormat(intlLocale(locale)).format(
                              d.generatedAt,
                            ),
                          })
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <form action={generateQuotePdf}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="quoteId" value={quote.id} />
                  <SubmitButton
                    label={t("pdfGenerate")}
                    pendingLabel={t("pdfGenerating")}
                    className="btn small"
                  />
                </form>
              </div>
            </article>
          </section>
        ))
      )}
    </>
  );
}
