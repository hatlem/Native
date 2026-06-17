import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { intlLocale } from "@/lib/money";
import { isProductPriceShown, arePricesVisible } from "@/lib/pricing/visibility";
import { bandLabel } from "@/lib/pricing/bands";
import { productBand, titleBand, unitRate } from "@/lib/pricing/display-price";
import { resolveProductionFee } from "@/lib/pricing/production-fee";
import type { ProductInclusions } from "@/lib/pricing/inclusions";
import { productDisplayNames } from "@/lib/pricing/display-name";
import { loadPricingDefaults } from "@/lib/content-fee";
import { addToPlan } from "@/app/plan-actions";
import { saveTitleToList } from "@/app/list-actions";
import { SubmitButton } from "@/components";
import { localizeCategory, localizeTaxonomy, localizeVertical } from "@/lib/taxonomy-i18n";
import type { AppLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

// Safety net: the 20260612080000 migration normalized known import slugs
// ("general-news") into canonical English values, and localizeCategory
// covers those. If a new import ever reintroduces a slug the category map
// doesn't know, render it human-readable instead of leaking the slug
// into the facts card.
function prettyCategory(value: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) return value;
  const words = value.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Written-content product types: the CPM rate buys distribution only and the
// article itself is produced + billed separately ("rateProductionNote"). For
// display / video CPM products the rate buys the placement, so that note must
// not show — otherwise a native-display unit reads as if it were an article.
const ARTICLE_TYPES = new Set(["NATIVE_ARTICLE", "ADVERTORIAL", "NATIVE_PLUS"]);

function inclusionLines(
  inc: ProductInclusions | null,
  t: Awaited<ReturnType<typeof getTranslations>>,
  currency: string,
): string[] {
  if (!inc) return [];
  const lines: string[] = [];
  // Min-spend leads: it is the headline commercial fact for bespoke/custom
  // content (Schibsted/FT partner content) and frames every other line.
  if (inc.minSpend)
    lines.push(t("inc.minSpend", { currency, amount: inc.minSpend }));
  if (inc.production === "PLATFORM") lines.push(t("inc.productionPlatform"));
  if (inc.production === "PUBLISHER") lines.push(t("inc.productionPublisher"));
  if (inc.production === "ADVERTISER") lines.push(t("inc.productionAdvertiser"));
  if (inc.viewsPerWeek)
    lines.push(t("inc.viewsPerWeek", { amount: inc.viewsPerWeek }));
  if (inc.viewsPerMonth)
    lines.push(t("inc.viewsPerMonth", { amount: inc.viewsPerMonth }));
  if (inc.viewsTotal)
    lines.push(t("inc.viewsTotal", { amount: inc.viewsTotal }));
  if (inc.readsTotal)
    lines.push(t("inc.readsTotal", { amount: inc.readsTotal }));
  if (inc.articles && inc.articles > 1)
    lines.push(t("inc.articles", { count: inc.articles }));
  if (inc.frontpage) lines.push(t("inc.frontpage"));
  if (inc.sovPct) lines.push(t("inc.sov", { pct: inc.sovPct }));
  if (inc.newsletter) lines.push(t("inc.newsletter"));
  if (inc.socialChannels?.length)
    lines.push(t("inc.socialChannels", { channels: inc.socialChannels.join(", ") }));
  else if (inc.social) lines.push(t("inc.social"));
  if (inc.video) lines.push(t("inc.video"));
  if (inc.photographer) lines.push(t("inc.photographer"));
  if (inc.translation) lines.push(t("inc.translation"));
  if (inc.report) lines.push(t("inc.report"));
  if (inc.print) lines.push(t("inc.print"));
  if (inc.rights) lines.push(t("inc.rights"));
  if (inc.searchableMonths)
    lines.push(t("inc.searchable", { months: inc.searchableMonths }));
  if (inc.durationWeeks)
    lines.push(t("inc.duration", { weeks: inc.durationWeeks }));
  return lines;
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
  const tCat = await getTranslations({ locale, namespace: "catalog" });
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
            {t("publishedBy")}{" "}
            {/* Media-house drill-down: every title from the same publisher
                (Amedia, Polaris, Aller, …) one click away. */}
            <Link
              href={`/catalog?publisher=${title.publisher.id}`}
              title={t("publisherLinkHelp", { name: title.publisher.name })}
            >
              {title.publisher.name}
            </Link>{" "}
            · {tMarket(title.market.code)}
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
          {/* Save the whole publication as a desk-resolved placeholder line —
              the buyer picks the format later, or the desk proposes one. */}
          <form action={saveTitleToList} style={{ marginTop: 12 }}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="titleId" value={title.id} />
            <button type="submit" className="btn ghost small">
              {tCat("savePublication")}
            </button>
          </form>
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
            <dd>{prettyCategory(localizeCategory(title.category, locale as AppLocale))}</dd>
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
          // band or a unit rate, hide that type's unpriced products.
          // Otherwise a title that got real quotes shows a ghost "Contact
          // for price" card next to four priced ones (Adresseavisen case).
          const banded = title.products.map((p) => ({
            p,
            band: productBand(p, title, pricing),
            rate: unitRate(p, title, pricing),
          }));
          const pricedTypes = new Set(
            banded.filter((x) => x.band || x.rate).map((x) => x.p.type),
          );
          const visible = banded.filter(
            (x) => x.band || x.rate || !pricedTypes.has(x.p.type),
          );
          // Headings are GENERATED from type + inclusions — never raw
          // p.name, which is publisher-offer text in the publisher's
          // language ("Native 1 sak (80k visn/mnd)") and desk-internal.
          // Computed for the whole card list so identical siblings get
          // disambiguated by their articles count.
          const numberFormat = new Intl.NumberFormat(intlLocale(locale));
          const displayNames = productDisplayNames(
            visible.map(({ p }) => ({
              typeLabel: tType(p.type),
              inclusions: p.inclusions as ProductInclusions | null,
            })),
            (n) => numberFormat.format(n),
            t,
          );
          return visible.map(({ p, band, rate }, cardIndex) => {
          const formatSlug = p.type.toLowerCase().replace(/_/g, "-");
          return (
            <article className="card" key={p.id}>
              <h3>{displayNames[cardIndex]}</h3>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <Link
                  href={`/formats#${formatSlug}`}
                  className="format-learn"
                >
                  {tFormats("learnMore")} →
                </Link>
              </div>
              {/* SECURITY: description/includedText/excludedText are RAW
                  QUOTE TEXT (publisher contacts, negotiated discounts,
                  gross/net figures — the Akersposten leak). Desk-only.
                  Buyers see ONLY buyerCopy: platform-written, per-locale,
                  populated by the curation swarm. */}
              {(() => {
                const lines = inclusionLines(
                  p.inclusions as ProductInclusions | null,
                  t,
                  p.currency,
                );
                if (lines.length === 0) return null;
                return (
                  <div className="muted small" style={{ marginTop: 8 }}>
                    <strong>{t("includedHeading")}</strong>
                    {lines.map((line) => (
                      <div key={line}>✓ {line}</div>
                    ))}
                  </div>
                );
              })()}
              {band ? (
                <>
                  <div className="price">
                    ≈ {bandLabel(band, p.currency)}{" "}
                    <span className="muted" title={tv("listIndicativeHelp")}>
                      · {tv("listIndicative")}
                    </span>
                  </div>
                  {/* Only claim production is included when WE actually
                      fold a production fee into this band — and defer to
                      the curated inclusions when they state who produces. */}
                  {!(p.inclusions as ProductInclusions | null)?.production &&
                  resolveProductionFee({
                    productFee:
                      p.productionFee == null ? null : Number(p.productionFee),
                    titleFee:
                      title.productionFeeDefault == null
                        ? null
                        : Number(title.productionFeeDefault),
                    productType: p.type,
                    marketCode: title.market.code,
                    rules: pricing.feeRules,
                  }) > 0 ? (
                    <div className="muted">✓ {tv("productionIncluded")}</div>
                  ) : null}
                </>
              ) : rate ? (
                // CPM/CPC rate card: marked-up unit rate, no band — the
                // all-in cost depends on volume, settled in the quote.
                // The rate buys DISTRIBUTION only; say so, or the buyer
                // reads "395 NOK CPM" as the whole price of the article.
                <>
                  <div className="price">
                    ≈ {rate.rate} {p.currency} {rate.unit}{" "}
                    <span className="muted" title={tv("listIndicativeHelp")}>
                      · {tv("listIndicative")}
                    </span>
                  </div>
                  {ARTICLE_TYPES.has(p.type) ? (
                    <div className="muted small">{t("rateProductionNote")}</div>
                  ) : null}
                </>
              ) : (
                <div className="price muted">{tv("requestPrice")}</div>
              )}
              {band && p.visibility === "FIRM" ? (
                <span className="tag">⚡ {tf("badge")}</span>
              ) : null}
              {/* Publisher-stated lead time when we have it; otherwise an
                  honest platform estimate, labelled as such. */}
              <div className="muted" style={{ marginTop: 6 }}>
                {p.leadTimeDays != null
                  ? `${t("leadTime")}: ${p.leadTimeDays} ${t("days")}`
                  : `${t("leadTime")}: ${t("leadTimeEstimated", { days: 10 })}`}
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
                  {band || rate ? <p className="note">{tv("firmTurnaround")}</p> : null}
                </>
              ) : (
                <p className="note">{t("unavailable")}</p>
              )}
            </article>
          );
          });
        })()}
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
          are display-only here; enforcement happens in the brief flow
          where the advertiser's category is actually known. */}
      {title.market.disclosureLabel ||
      title.market.restrictedCategories.length > 0 ? (
        <aside
          className="card"
          style={{ marginTop: 16 }}
          aria-label={t("marketRules.heading")}
        >
          <h3 style={{ marginTop: 0 }}>{t("marketRules.heading")}</h3>
          {title.market.disclosureLabel ? (
            <p className="muted" style={{ margin: 0 }}>
              ✓{" "}
              {t("marketRules.labeling", {
                label: title.market.disclosureLabel,
                market: tMarket(title.market.code),
              })}
            </p>
          ) : null}
          {title.market.restrictedCategories.length > 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              ✗{" "}
              {t("marketRules.restricted", {
                categories: title.market.restrictedCategories
                  .map((c) => t(`restrictedCategory.${c}`))
                  .join(", "),
              })}
            </p>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
