import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";
import { addToPlan } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function TitleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "titleDetail" });
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

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

  if (!title || !title.active) notFound();

  const siteBase =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "";
  const ldOffers = title.products.map((p) => ({
    "@type": "Offer",
    name: p.name,
    priceCurrency: p.currency,
    price: indicativeFromRules(Number(p.basePrice), toRateRules(p.priceRules)),
    availability: p.bookable
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock",
  }));
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: title.name,
    category: title.category,
    brand: { "@type": "Brand", name: title.publisher.name },
    url: `${siteBase}/${locale}/catalog/${title.slug}`,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: title.market.currency,
      offers: ldOffers,
    },
  };

  const productCount = title.products.length;
  const bookableCount = title.products.filter((p) => p.bookable).length;
  const allPrices = title.products.map((p) =>
    indicativeFromRules(Number(p.basePrice), toRateRules(p.priceRules)),
  );
  const fromPrice = allPrices.length ? Math.min(...allPrices) : null;
  const currency =
    title.products[0]?.currency ?? title.market.currency;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/catalog" className="small-link">
          ← {t("back")}
        </Link>
      </nav>

      <header className="detail-head">
        <div>
          <div className="cluster tight" style={{ marginBottom: 10 }}>
            <span className="tag">{tMarket(title.market.code)}</span>
            {title.category ? <span className="tag">{title.category}</span> : null}
            {title.products.some((p) => p.visibility === "FIRM") ? (
              <span className="badge badge-info dotless">
                ⚡ {tf("badge")}
              </span>
            ) : null}
          </div>
          <h1>{title.name}</h1>
          <p className="lead">
            {t("publishedBy")} {title.publisher.name}
          </p>
        </div>
        <aside className="detail-meta">
          {title.monthlyReach ? (
            <div className="meta-row">
              <span className="muted small">{t("reach")}</span>
              <span className="value">
                {new Intl.NumberFormat(locale).format(title.monthlyReach)}
              </span>
            </div>
          ) : null}
          <div className="meta-row">
            <span className="muted small">{t("formats")}</span>
            <span className="value">{productCount}</span>
          </div>
          {fromPrice !== null ? (
            <div className="meta-row">
              <span className="muted small">{t("from")}</span>
              <span className="value">
                {formatMoney(fromPrice, currency, locale)}
              </span>
            </div>
          ) : null}
        </aside>
      </header>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("formatsEyebrow")}</span>
            <h2>{t("formatsHeading")}</h2>
          </div>
          {bookableCount > 0 ? (
            <span className="muted small">
              {t("bookableSummary", { count: bookableCount })}
            </span>
          ) : null}
        </div>

        <div className="grid">
          {title.products.map((p) => {
            const price = indicativeFromRules(
              Number(p.basePrice),
              toRateRules(p.priceRules),
            );
            return (
              <article className="card product-detail-card" key={p.id}>
                <div className="cluster tight" style={{ marginBottom: 8 }}>
                  <h3 style={{ margin: 0 }}>{tType(p.type)}</h3>
                  {p.visibility === "FIRM" ? (
                    <span className="badge badge-info dotless">
                      ⚡ {tf("badge")}
                    </span>
                  ) : null}
                </div>
                <div className="price">
                  <span className="currency">{t("from")}</span>
                  {formatMoney(price, p.currency, locale)}
                </div>
                <div className="cluster tight" style={{ marginTop: 10 }}>
                  <span className="tag">
                    {t("leadTime")}: {p.leadTimeDays} {t("days")}
                  </span>
                </div>
                {p.spec ? (
                  <dl className="spec-grid">
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
                ) : null}
                {p.bookable ? (
                  <form action={addToPlan} className="product-cta">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="productId" value={p.id} />
                    <button type="submit" className="btn block">
                      {t("addToPlan")}
                    </button>
                  </form>
                ) : (
                  <p className="muted small product-cta">{t("unavailable")}</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <p className="note">{t("indicativeNote")}</p>
    </>
  );
}
