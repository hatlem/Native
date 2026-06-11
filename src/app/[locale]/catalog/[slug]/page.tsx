import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { intlLocale } from "@/lib/money";
import { isProductPriceShown, arePricesVisible } from "@/lib/pricing/visibility";
import { bandLabel } from "@/lib/pricing/bands";
import { productBand, titleBand } from "@/lib/pricing/display-price";
import { loadPricingDefaults } from "@/lib/content-fee";
import { addToPlan } from "@/app/plan-actions";
import { SubmitButton } from "@/components";
import { localizeTaxonomy, localizeVertical } from "@/lib/taxonomy-i18n";
import type { AppLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function TitleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/signin?next=/${locale}/catalog/${slug}`);
  }
  // CSP nonce from middleware — required for the inline ld+json <script> below.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const t = await getTranslations({ locale, namespace: "titleDetail" });
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tFormats = await getTranslations({ locale, namespace: "formats" });
  const tv = await getTranslations({
    locale,
    namespace: "priceVisibility",
  });

  const title = await prisma.title.findUnique({
    where: { slug },
    include: {
      publisher: true,
      market: true,
      products: {
        where: { active: true },
        include: { priceRules: true, spec: true },
      },
    },
  });

  if (!title) notFound();
  // Discontinued (nedlagt/duplikat) titles never render. Verified-no-native
  // titles stay hidden; everything else (commerce-active and unverified
  // research-catalog rows) renders.
  if (title.discontinuedAt) notFound();
  if (!title.active && title.lastVerifiedAt) notFound();

  const pricing = await loadPricingDefaults();

  // Title-level visibility gate (pricesPublic flags only) — used for
  // schema.org AggregateOffer wrapper and the bottom note.
  const titlePriceVisible = arePricesVisible(title);
  const siteBase =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "";
  // JSON-LD must NEVER carry an exact figure — structured data is the
  // easiest scrape target on the site. Per-product Offers carry no price;
  // the AggregateOffer carries the band bounds (valid schema.org, keeps
  // discovery value).
  const ldOffers = title.products.map((p) => ({
    "@type": "Offer",
    name: p.name,
    priceCurrency: p.currency,
    availability: p.bookable
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock",
  }));
  const anyPriceVisible = title.products.some((p) =>
    isProductPriceShown(p, title),
  );
  const ldBand = titleBand(title.products, title, pricing);
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: title.name,
    category: title.category,
    brand: { "@type": "Brand", name: title.publisher.name },
    url: `${siteBase}/${locale}/catalog/${title.slug}`,
    offers: ldBand
      ? {
          "@type": "AggregateOffer",
          priceCurrency: ldBand.product.currency,
          ...(ldBand.band.kind !== "under" ? { lowPrice: ldBand.band.low } : {}),
          ...(ldBand.band.kind !== "over" ? { highPrice: ldBand.band.high } : {}),
          offers: ldOffers,
        }
      : { "@type": "AggregateOffer", offers: ldOffers },
  };
  const needsQuote = title.products.length === 0;

  return (
    <section>
      <script
        type="application/ld+json"
        nonce={nonce}
        // schema.org JSON-LD: PLAN §14 "structured data for discovery".
        // Escape "<" to < so a stored "</script>" payload in
        // Title.name / Publisher.name / Product.name (admin-controlled
        // today, but could become editable later) can't break out of
        // this <script> block.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(ld).replace(/</g, "\\u003C"),
        }}
      />
      <p>
        <Link href="/catalog">← {t("back")}</Link>
      </p>
      <h1>{title.name}</h1>
      <p className="muted">
        {t("publishedBy")} {title.publisher.name} · {tMarket(title.market.code)}{" "}
        · {title.category}
      </p>
      {title.offersNativeContent ? (
        <p style={{ marginTop: 8 }}>
          <span className="tag">{t("offersNative")}</span>
        </p>
      ) : null}
      {title.description ? (
        <p style={{ marginTop: 8 }}>{title.description}</p>
      ) : null}
      {title.digitalReach ? (
        <p className="muted">
          {t("digitalReach")}:{" "}
          {new Intl.NumberFormat(intlLocale(locale)).format(title.digitalReach)}
        </p>
      ) : title.monthlyReach ? (
        <p className="muted">
          {t("reach")}: {new Intl.NumberFormat(intlLocale(locale)).format(title.monthlyReach)}
        </p>
      ) : null}
      {/* Surface the rest of the CSV-imported research metadata so buyers
          can size up a research-catalog title even before requesting a quote. */}
      {title.type ||
      title.frequency ||
      title.b2bB2c ||
      title.format ||
      title.nativeFit ||
      title.reach ? (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {title.type ? <span className="tag">{localizeTaxonomy(title.type, locale as AppLocale)}</span> : null}
          {title.frequency ? (
            <span className="tag">{localizeTaxonomy(title.frequency, locale as AppLocale)}</span>
          ) : null}
          {title.b2bB2c ? <span className="tag">{localizeTaxonomy(title.b2bB2c, locale as AppLocale)}</span> : null}
          {title.format ? <span className="tag">{localizeTaxonomy(title.format, locale as AppLocale)}</span> : null}
          {title.nativeFit ? (
            <span className="tag">
              {t("nativeFitTag", { value: title.nativeFit })}
            </span>
          ) : null}
          {title.reach ? <span className="tag">{title.reach}</span> : null}
        </div>
      ) : null}
      {title.vertical ? (
        <p className="muted" style={{ marginTop: 8 }}>
          {localizeVertical(title.vertical, locale as AppLocale)}
        </p>
      ) : null}
      {title.audience ? (
        <p className="muted">{localizeVertical(title.audience, locale as AppLocale)}</p>
      ) : null}
      {title.keywords.length ? (
        <div style={{ marginTop: 8 }}>
          <span className="muted small">{t("keywordsHeading")}: </span>
          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
            {title.keywords.map((k) => (
              <span className="tag" key={k}>
                {k}
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {/* Market-level disclosure label — surfaced BEFORE the quote so
          regulated buyers (UWG-DE/AT, KSML-FI, CAP-UK, ASAI-IE) can
          confirm what label the platform will require on published
          native content. Closes the Linnea scenario finding that the
          per-market regulatory floor was invisible until quote stage. */}
      {title.market.disclosureLabel ? (
        <p
          className="muted"
          style={{ marginTop: 8, fontSize: "0.85em" }}
          aria-label={t("disclosureLabel.aria")}
        >
          <strong>{t("disclosureLabel.heading")}:</strong>{" "}
          <span className="tag" style={{ marginLeft: 4 }}>
            “{title.market.disclosureLabel}”
          </span>{" "}
          <span style={{ marginLeft: 4 }}>
            {t("disclosureLabel.body")}
          </span>
        </p>
      ) : null}

      {needsQuote ? (
        <article className="card" style={{ marginTop: 16 }}>
          <h3>{t("requestQuote.title")}</h3>
          <p className="muted">{t("requestQuote.body")}</p>
          <Link href="/plan" className="btn" style={{ marginTop: 8 }}>
            {t("requestQuote.cta")}
          </Link>
        </article>
      ) : (
        <div className="grid">
        {title.products.map((p) => {
          const band = productBand(p, title, pricing);
          const formatSlug = p.type.toLowerCase().replace(/_/g, "-");
          return (
            <article className="card" key={p.id}>
              <h3>{tType(p.type)}</h3>
              <Link
                href={`/formats#${formatSlug}`}
                className="format-learn"
              >
                {tFormats("learnMore")} →
              </Link>
              {band ? (
                <>
                  <div className="price">
                    ≈ {bandLabel(band, p.currency)}{" "}
                    <span className="muted" title={tv("listIndicativeHelp")}>
                      · {tv("listIndicative")}
                    </span>
                  </div>
                  <div className="muted">✓ {tv("productionIncluded")}</div>
                </>
              ) : (
                <div className="price muted">{tv("requestPrice")}</div>
              )}
              {band && p.visibility === "FIRM" ? (
                <span className="tag">⚡ {tf("badge")}</span>
              ) : null}
              <div className="muted" style={{ marginTop: 6 }}>
                {t("leadTime")}: {p.leadTimeDays} {t("days")}
              </div>
              {p.spec ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  <strong>{t("spec")}</strong>
                  <dl className="spec-list">
                    {p.spec.wordCountMin && p.spec.wordCountMax ? (
                      <>
                        <dt>{t("words")}</dt>
                        <dd>
                          {p.spec.wordCountMin}–{p.spec.wordCountMax}
                        </dd>
                      </>
                    ) : null}
                    <dt>{t("images")}</dt>
                    <dd>{p.spec.imagesMin ?? 0}</dd>
                    {p.spec.disclosureLabel ? (
                      <>
                        <dt>{t("disclosure")}</dt>
                        <dd>{p.spec.disclosureLabel}</dd>
                      </>
                    ) : null}
                  </dl>
                </div>
              ) : null}
              {p.bookable ? (
                <>
                  <form action={addToPlan} style={{ marginTop: 12 }}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="productId" value={p.id} />
                    <SubmitButton
                      label={t("addToPlan")}
                      pendingLabel={t("addingToPlan")}
                    />
                  </form>
                  {band ? <p className="note">{tv("firmTurnaround")}</p> : null}
                </>
              ) : (
                <p className="note">{t("unavailable")}</p>
              )}
            </article>
          );
        })}
        </div>
      )}

      {anyPriceVisible ? (
        <p className="note">{t("indicativeNote")}</p>
      ) : !titlePriceVisible ? (
        <p className="note">{tv("requestPriceHelp")}</p>
      ) : null}
    </section>
  );
}
