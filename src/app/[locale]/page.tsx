import { getTranslations } from "next-intl/server";
import { MarketCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  const valueProps = [
    { title: t("vp1Title"), body: t("vp1Body") },
    { title: t("vp2Title"), body: t("vp2Body") },
    { title: t("vp3Title"), body: t("vp3Body") },
  ];
  const markets: MarketCode[] = ["NO", "SE", "DK"];

  const [titleCount, productCount, featured] = await Promise.all([
    prisma.title.count({ where: { active: true } }),
    prisma.product.count({ where: { active: true } }),
    prisma.title.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      take: 6,
      include: {
        market: true,
        publisher: { select: { name: true } },
        products: {
          where: { active: true },
          include: { priceRules: true },
        },
      },
    }),
  ]);

  const siteBase =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "";
  const orgLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "BeNative",
    url: siteBase || `/${locale}`,
    areaServed: ["Norway", "Sweden", "Denmark"],
    description: t("subtitle"),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }}
      />

      <section className="hero">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("subtitle")}</p>
        <div className="hero-actions">
          <Link href="/catalog" className="btn large">
            {t("cta")}
          </Link>
          <Link href="/how-it-works" className="btn secondary large">
            {tm("howCta")}
          </Link>
        </div>

        <div className="hero-stats">
          <Stat value={titleCount} label={t("statsTitles")} />
          <Stat value={productCount} label={t("statsProducts")} />
          <Stat value={markets.length} label={t("statsMarkets")} />
        </div>

        <div className="markets" aria-label={t("statsMarkets")}>
          {markets.map((m) => (
            <span className="tag" key={m}>
              {tMarket(m)}
            </span>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("featuredEyebrow")}</span>
            <h2>{t("featuredTitle")}</h2>
          </div>
          <Link href="/catalog" className="link">
            {t("featuredCta")} →
          </Link>
        </div>
        <div className="grid">
          {featured.map((title) => {
            const prices = title.products.map((p) =>
              indicativeFromRules(
                Number(p.basePrice),
                toRateRules(p.priceRules),
              ),
            );
            const from = prices.length ? Math.min(...prices) : null;
            const currency =
              title.products[0]?.currency ?? title.market.currency;
            return (
              <Link
                href={`/catalog/${title.slug}`}
                key={title.id}
                className="card hoverable title-card"
              >
                <span className="tag">{tMarket(title.market.code)}</span>
                <h3>{title.name}</h3>
                <p className="muted">{title.publisher.name}</p>
                {title.category ? (
                  <p className="muted small">{title.category}</p>
                ) : null}
                {from !== null ? (
                  <div className="price">
                    <span className="currency">{t("priceFrom")}</span>
                    {formatMoney(from, currency, locale)}
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("whyEyebrow")}</span>
            <h2>{tm("audiencesTitle")}</h2>
          </div>
        </div>
        <div className="grid">
          {valueProps.map((vp) => (
            <div className="card" key={vp.title}>
              <h3>{vp.title}</h3>
              <p className="muted">{vp.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="grid two">
          {(
            [
              ["for-advertisers", "audAdvertiser"],
              ["for-agencies", "audAgency"],
              ["for-publishers", "audPublisher"],
            ] as const
          ).map(([href, key]) => (
            <article className="card hoverable" key={href}>
              <h3>{tm(`${key}Title`)}</h3>
              <p className="muted">{tm(`${key}Body`)}</p>
              <p className="card-link">
                <Link href={`/${href}`} className="link">
                  {tm("learnMore")} →
                </Link>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="section cta-block">
        <h2>{tm("ctaBlockTitle")}</h2>
        <p className="muted">{tm("ctaBlockBody")}</p>
        <div className="hero-actions">
          <Link href="/catalog" className="btn large">
            {tm("browseCatalog")}
          </Link>
          <Link href="/signup" className="btn secondary large">
            {tm("createAccount")}
          </Link>
        </div>
      </section>
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="hero-stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
