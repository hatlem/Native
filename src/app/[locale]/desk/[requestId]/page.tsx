import { Fragment } from "react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { LINE_NOTE_MAX } from "@/lib/line-note";
import { resolvePlanTitleItem, removePlanTitleItem } from "@/app/desk-actions";
import { loadPricingDefaults } from "@/lib/content-fee";
import {
  customerPrice,
  productBand,
  unitRate,
} from "@/lib/pricing/display-price";
import { bandLabel, priceBand } from "@/lib/pricing/bands";
import { StatusBadge } from "@/app/status-badge";
import { MailLink, SafeEmail, SubmitButton, withSafeEmails } from "@/components";
import { canSeeCostVsSell } from "@/lib/roles";
import { isStorageConfigured, presignDownload } from "@/lib/storage/r2";
import { intlLocale } from "@/lib/money";
import {
  QUOTE_VALIDITY_DAYS,
  QUOTE_VALIDITY_MAX_DAYS,
  isQuoteEditable,
  isQuoteExpired,
  isQuoteRevisable,
  quoteValidUntilInputValue,
} from "@/lib/commerce/quote-validity";
import { lineOrder } from "@/lib/commerce/line-order";
import { invoiceLineLabel } from "@/lib/invoice-line-label";
import {
  discardQuoteRevisionAction,
  generateQuote,
  generateQuotePdf,
  renewQuote,
  reviseQuoteAction,
  sendQuote,
  setQuoteLineNote,
  setQuoteLinePrice,
} from "@/app/quote-actions";

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
  // Quote-PDF outcome (quote-actions.ts generateQuotePdf). Storage is also
  // checked on render so the desk sees why no PDF can be made before
  // clicking, not after.
  const storageReady = isStorageConfigured();
  const pdfNotice: "pdfStorageUnavailable" | "pdfFailed" | "pdfSuperseded" | null = !storageReady ||
    sp.pdf === "storage-unavailable"
    ? "pdfStorageUnavailable"
    : sp.pdf === "failed"
      ? "pdfFailed"
      : sp.pdf === "superseded"
        ? "pdfSuperseded"
        : null;
  // Quote-level refusals from the line-edit / revision / send actions.
  const quoteError =
    errorCode === "quote-locked"
      ? "quoteLocked"
      : errorCode === "quote-not-revisable"
        ? "quoteNotRevisable"
        : errorCode === "revision-predecessor-closed"
          ? "revisionPredecessorClosed"
          : null;
  const t = await getTranslations({ locale, namespace: "desk" });
  const tr = await getTranslations({ locale, namespace: "requests" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const lineLabelDeps = {
    formatLabel: (type: string) => (tType.has(type) ? tType(type) : type),
    contentProduction: tType("CONTENT_FEE"),
  };
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
            orderBy: lineOrder(),
            include: {
              priceSetBy: { select: { name: true, email: true } },
            },
          },
          order: true,
          documents: { orderBy: { version: "desc" } },
          // Revision chain (lib/commerce/quote-revision.ts).
          nextRevision: { select: { id: true, revision: true, status: true } },
          previousQuote: { select: { id: true, revision: true } },
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

  // Draft quotes are the desk's work in progress: invisible to the buyer
  // until "Send quote" sends them all at once with the chosen validity.
  const draftQuotes = request.quotes.filter((q) => q.status === "DRAFT" && !q.order);
  const now = new Date();
  const validityInput = {
    defaultValue: quoteValidUntilInputValue(now),
    min: quoteValidUntilInputValue(now, now),
    max: quoteValidUntilInputValue(
      now,
      new Date(now.getTime() + QUOTE_VALIDITY_MAX_DAYS * 24 * 60 * 60 * 1000),
    ),
  };
  const validityError =
    errorCode === "valid-until-invalid"
      ? t("validUntilInvalid")
      : errorCode === "valid-until-past"
        ? t("validUntilPast")
        : errorCode === "valid-until-too-far"
          ? t("validUntilTooFar", { max: QUOTE_VALIDITY_MAX_DAYS })
          : null;

  // Who to actually reach out to for this title — the answer used to live
  // only on /desk/titles/[id], several clicks away from where the desk is
  // deciding what to book.
  function ContactLine({ titleId }: { titleId: string | null | undefined }) {
    const contact = titleId ? contactByTitleId.get(titleId) : undefined;
    if (!contact) return <p className="muted small">{t("salesContactMissing")}</p>;
    return (
      <p className="muted small">
        {contact.name} ·{" "}
        <MailLink to={contact.email}>
          <SafeEmail address={contact.email} />
        </MailLink>
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
        <>
          {validityError ? (
            <div className="banner-warn" role="alert">
              <span>{validityError}</span>
            </div>
          ) : null}
          {quoteError ? (
            <div className="banner-warn" role="alert">
              <span>{t(quoteError)}</span>
            </div>
          ) : null}
          {quotesWithDownloadUrls.map((quote) => (
            <section className="section" key={quote.id} id={`quote-${quote.id}`}>
              <div className="section-head">
                <div>
                  <span className="eyebrow">{t("quoteEyebrow")}</span>
                  <h2>
                    {t("pdfQuoteLabel", { currency: quote.currency })}
                    {quote.revision > 1 ? (
                      <>
                        {" "}
                        <span className="tag">{t("quoteRevisionBadge", { revision: quote.revision })}</span>
                      </>
                    ) : null}
                    {quote.status === "DRAFT" ? (
                      <>
                        {" "}
                        <span className="tag">{t("quoteDraftBadge")}</span>
                      </>
                    ) : quote.status === "SUPERSEDED" ? (
                      <>
                        {" "}
                        <span className="tag">{t("quoteSupersededBadge")}</span>
                      </>
                    ) : null}
                  </h2>
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
                {errorCode === "note-too-long" ? (
                  <div className="banner-warn" role="alert">
                    <span>{t("lineNoteTooLong", { max: LINE_NOTE_MAX })}</span>
                  </div>
                ) : null}
                {quote.status === "DRAFT" && quote.previousQuote ? (
                  // An unsent revision: the customer still holds its predecessor.
                  <div className="quote-validity">
                    <p className="muted small">
                      {t("quoteRevisionDraftHint", { previous: quote.previousQuote.revision })}
                    </p>
                    <form action={discardQuoteRevisionAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="requestId" value={request.id} />
                      <input type="hidden" name="quoteId" value={quote.id} />
                      <SubmitButton
                        label={t("discardRevision")}
                        pendingLabel={t("discardingRevision")}
                        className="btn small ghost"
                      />
                    </form>
                  </div>
                ) : quote.status === "DRAFT" ? (
                  <p className="muted small">{t("quoteDraftHint")}</p>
                ) : quote.status === "SUPERSEDED" ? (
                  <p className="muted small">
                    {quote.nextRevision ? (
                      <a href={`#quote-${quote.nextRevision.id}`}>
                        {t("quoteSupersededBy", { revision: quote.nextRevision.revision })}
                      </a>
                    ) : null}
                  </p>
                ) : quote.order ? null : (
                  <div className="quote-validity">
                    <span className={isQuoteExpired(quote) ? "tag" : "muted small"}>
                      {quote.validUntil
                        ? t(isQuoteExpired(quote) ? "quoteExpiredOn" : "quoteValidUntil", {
                            date: new Intl.DateTimeFormat(intlLocale(locale), {
                              dateStyle: "medium",
                            }).format(quote.validUntil),
                          })
                        : t("quoteNoExpiry")}
                    </span>
                    {isQuoteExpired(quote) ? (
                      <form action={renewQuote} className="resolve-line">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="requestId" value={request.id} />
                        <input type="hidden" name="quoteId" value={quote.id} />
                        <label className="muted small">
                          {t("renewValidUntil")}{" "}
                          <input type="date" name="validUntil" required {...validityInput} />
                        </label>
                        <SubmitButton
                          label={t("renewQuote")}
                          pendingLabel={t("renewingQuote")}
                          className="btn small"
                        />
                      </form>
                    ) : null}
                  </div>
                )}
                {quote.order || !isQuoteExpired(quote) ? null : (
                  <p className="muted small">{t("renewQuoteHint")}</p>
                )}
                {/* A sent offer is locked: its lines change only through a
                    revision (lib/commerce/quote-revision.ts). One revision at
                    a time — while one is drafted, point at it instead. */}
                {quote.nextRevision && quote.nextRevision.status === "DRAFT" ? (
                  <p className="muted small">
                    <a href={`#quote-${quote.nextRevision.id}`}>
                      {t("quoteRevisionPending", { revision: quote.nextRevision.revision })}
                    </a>
                  </p>
                ) : isQuoteRevisable(quote) ? (
                  <div className="quote-validity">
                    <form action={reviseQuoteAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="requestId" value={request.id} />
                      <input type="hidden" name="quoteId" value={quote.id} />
                      <SubmitButton
                        label={t("reviseQuote")}
                        pendingLabel={t("revisingQuote")}
                        className="btn small secondary"
                      />
                    </form>
                    <p className="muted small">{t("reviseQuoteHint")}</p>
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
                    // Only a DRAFT's lines change; a sent quote is revised instead.
                    const editable = isQuoteEditable(quote);
                    return (
                      <Fragment key={l.id}>
                        <div className="quote-line">
                          <span>
                            {/* The description is a snapshot of the product name
                                at quoting time; older ones end in a raw type enum
                                ("… — NATIVE_DISPLAY"), relabelled for display only. */}
                            {invoiceLineLabel(
                              { description: l.description, kind: l.kind },
                              lineLabelDeps,
                            )}{" "}
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
                            {/* The name may fall back to an address: route it
                                through SafeEmail (Cloudflare obfuscation). */}
                            {withSafeEmails(
                              t("linePriceSetBy", {
                                name:
                                  l.priceSetBy?.name ??
                                  l.priceSetBy?.email ??
                                  t("linePriceSetByUnknown"),
                                date: new Intl.DateTimeFormat(intlLocale(locale), {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                }).format(l.priceSetAt),
                              }),
                            )}
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
                        {l.customerNote ? (
                          <p className="line-note__text">
                            <span className="line-note__label">{t("lineNoteLabel")}</span>
                            {l.customerNote}
                          </p>
                        ) : null}
                        {editable ? (
                          <details className="line-note__edit">
                            <summary>
                              {l.customerNote ? t("lineNoteEdit") : t("lineNoteAdd")}
                            </summary>
                            <form action={setQuoteLineNote} className="line-note__form">
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="requestId" value={request.id} />
                              <input type="hidden" name="quoteId" value={quote.id} />
                              <input type="hidden" name="lineId" value={l.id} />
                              <textarea
                                name="note"
                                rows={3}
                                maxLength={LINE_NOTE_MAX}
                                defaultValue={l.customerNote ?? ""}
                                aria-label={t("lineNoteLabel")}
                              />
                              <p className="muted small">{t("lineNoteHint")}</p>
                              <button type="submit" className="btn small">
                                {t("lineNoteSave")}
                              </button>
                            </form>
                          </details>
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
                ) : quote.status === "DRAFT" || quote.status === "SUPERSEDED" ? null : (
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
                  {pdfNotice ? (
                    <p className="banner-error" role="alert">
                      {t(pdfNotice)}
                    </p>
                  ) : null}
                  {/* A replaced quote is history: its earlier PDFs stay listed
                      above, but no new customer document is made from it
                      (lib/pdf/quote-pdf-data QuoteSupersededError). */}
                  {quote.status === "SUPERSEDED" ? null : (
                  <div className="quote-pdf-actions">
                    {/* Without object storage a PDF version can't be saved,
                        so the button would only ever fail — explain up front. */}
                    {storageReady ? (
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
                    ) : null}
                    <a
                      className="btn small ghost"
                      href={`/api/export/quote-docx/${quote.id}?locale=${locale}`}
                      download
                    >
                      {t("docxDownload")}
                    </a>
                  </div>
                  )}
                </div>
              </article>
            </section>
          ))}
          {draftQuotes.length > 0 ? (
            <section className="section">
              <div className="cta-block">
                <h2>{t("sendTitle")}</h2>
                <p className="muted">{t("sendBody", { count: draftQuotes.length })}</p>
                {draftQuotes.some((q) => q.previousQuoteId) ? (
                  <p className="muted small">{t("sendRevisionNote")}</p>
                ) : null}
                {errorCode === "send-unpriced" ? (
                  <div className="banner-warn" role="alert">
                    <span>{t("sendUnpriced")}</span>
                  </div>
                ) : null}
                <form action={sendQuote} className="resolve-line">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="requestId" value={request.id} />
                  <label>
                    {t("sendValidUntil")}{" "}
                    <input type="date" name="validUntil" required {...validityInput} />
                  </label>
                  <SubmitButton
                    label={t("send")}
                    pendingLabel={t("sending")}
                    className="btn large"
                  />
                </form>
                <p className="muted small">
                  {t("sendValidUntilHint", {
                    days: QUOTE_VALIDITY_DAYS,
                    max: QUOTE_VALIDITY_MAX_DAYS,
                  })}
                </p>
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
