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

// Some Title.category values are raw import slugs ("general-news") the
// taxonomy map doesn't cover. When localization passes the value through
// untouched and it still looks like a slug, render it human-readable
// instead of leaking the slug into the facts card.
function prettyCategory(value: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) return value;
  const words = value.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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

      {/* Two-column header: identity/description left, labelled key
          facts right. The facts card replaces the old loose stack of
          unlabelled metadata lines (raw category slug, floating
          type/audience text) — every datum now has a label, and only
          rows with data render. */}
      <div className="detail-head">
        <div>
          <h1>{title.name}</h1>
          <p className="muted">
            {t("publishedBy")} {title.publisher.name} ·{" "}
            {tMarket(title.market.code)}
          </p>
          {title.description ? (
            <p style={{ marginTop: 8 }}>{title.description}</p>
          ) : null}
          {title.vertical ? (
            <p className="muted" style={{ marginTop: 8 }}>
              {localizeVertical(title.vertical, locale as AppLocale)}
            </p>
          ) : null}
          {title.audience ? (
            <p className="muted">
              {localizeVertical(title.audience, locale as AppLocale)}
            </p>
          ) : null}
          {title.offersNativeContent || title.reach || title.keywords.length ? (
            <div
              style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}
            >
              {title.offersNativeContent ? (
                <span className="tag">{t("offersNative")}</span>
              ) : null}
              {title.reach ? <span className="tag">{title.reach}</span> : null}
              {title.keywords.map((k) => (
                <span className="tag" key={k}>
                  {k}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="card" aria-label={t("keyFacts")}>
          <h3 style={{ marginTop: 0 }}>{t("keyFacts")}</h3>
          <dl className="spec-list">
            {title.digitalReach ? (
              <>
                <dt>{t("digitalReach")}</dt>
                <dd>
                  {new Intl.NumberFormat(intlLocale(locale)).format(
                    title.digitalReach,
                  )}
                </dd>
              </>
            ) : null}
            {title.monthlyReach ? (
              <>
                <dt>{t("reach")}</dt>
                <dd>
                  {new Intl.NumberFormat(intlLocale(locale)).format(
                    title.monthlyReach,
                  )}
                </dd>
              </>
            ) : null}
            {title.frequency ? (
              <>
                <dt>{t("factFrequency")}</dt>
                <dd>{localizeTaxonomy(title.frequency, locale as AppLocale)}</dd>
              </>
            ) : null}
            {title.type ? (
              <>
                <dt>{t("factType")}</dt>
                <dd>{localizeTaxonomy(title.type, locale as AppLocale)}</dd>
              </>
            ) : null}
            {title.format ? (
              <>
                <dt>{t("factFormat")}</dt>
                <dd>{localizeTaxonomy(title.format, locale as AppLocale)}</dd>
              </>
            ) : null}
            {title.b2bB2c ? (
              <>
                <dt>{t("factAudience")}</dt>
                <dd>{localizeTaxonomy(title.b2bB2c, locale as AppLocale)}</dd>
              </>
            ) : null}
            {title.nativeFit ? (
              <>
                <dt>{t("factNativeFit")}</dt>
                <dd>{title.nativeFit}</dd>
              </>
            ) : null}
            <dt>{t("factCategory")}</dt>
            <dd>{prettyCategory(localizeTaxonomy(title.category, locale as AppLocale))}</dd>
          </dl>
        </aside>
      </div>

      {!needsQuote ? (
        <div className="section-head">
          <h2>{t("formatsHeading")}</h2>
        </div>
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
        {(() => {
          // A confirmed, priced offer supersedes the seeded placeholder of
          // the same format: when at least one product of a type carries a
          // band, hide that type's band-less products. Otherwise a title
          // that got real quotes shows a ghost "Contact for price" card
          // next to four priced ones (Adresseavisen case).
          const banded = title.products.map((p) => ({
            p,
            band: productBand(p, title, pricing),
          }));
          const pricedTypes = new Set(
            banded.filter((x) => x.band).map((x) => x.p.type),
          );
          return banded.filter(
            (x) => x.band || !pricedTypes.has(x.p.type),
          );
        })().map(({ p, band }) => {
          const formatSlug = p.type.toLowerCase().replace(/_/g, "-");
          // Quote-created products carry a specific offer name ("Native
          // 1 sak, 80k visn/mnd"); seeded ones repeat the type label or a
          // machine name embedding the raw enum ("The Sun — NATIVE_ARTICLE").
          // Heading shows the specific name, the type tag dedupes itself.
          const typeLabel = tType(p.type);
          const showName =
            !!p.name && p.name !== typeLabel && !p.name.includes(p.type);
          return (
            <article className="card" key={p.id}>
              <h3>{showName ? p.name : typeLabel}</h3>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {showName ? <span className="tag">{typeLabel}</span> : null}
                <Link
                  href={`/formats#${formatSlug}`}
                  className="format-learn"
                >
                  {tFormats("learnMore")} →
                </Link>
              </div>
              {p.description ? (
                <p className="muted small" style={{ marginTop: 6 }}>
                  {p.description}
                </p>
              ) : null}
              {band ? (
                <>
                  <div className="price">
                    ≈ {bandLabel(band, p.currency)}{" "}
                    <span className="muted" title={tv("listIndicativeHelp")}>
                      · {tv("listIndicative")}
                    </span>
                  </div>
                  {/* What the price buys — the three things every
                      NativeSpin order includes, so the buyer never has
                      to guess whether production or labeling costs extra. */}
                  <div className="muted small" style={{ marginTop: 6 }}>
                    <strong>{t("includedHeading")}</strong>
                    <div>✓ {tv("productionIncluded")}</div>
                    <div>✓ {t("includedPublication", { name: title.name })}</div>
                    <div>✓ {t("includedLabeling")}</div>
                  </div>
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

      {/* Market rules — reassurance, not a demand. The disclosure label
          is handled by the publisher; foreign buyers (UWG-DE/AT, KSML-FI,
          CAP-UK, ASAI-IE markets) see what local law requires without
          having to know it. Category restrictions (e.g. gambling in NO)
          slot in here once the per-market data field lands; enforcement
          happens in the brief flow where the advertiser's category is
          actually known. */}
      {title.market.disclosureLabel ? (
        <aside
          className="card"
          style={{ marginTop: 16 }}
          aria-label={t("marketRules.heading")}
        >
          <h3 style={{ marginTop: 0 }}>{t("marketRules.heading")}</h3>
          <p className="muted" style={{ margin: 0 }}>
            ✓{" "}
            {t("marketRules.labeling", {
              label: title.market.disclosureLabel,
              market: tMarket(title.market.code),
            })}
          </p>
        </aside>
      ) : null}
    </section>
  );
}
