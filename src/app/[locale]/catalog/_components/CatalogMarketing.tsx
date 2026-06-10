import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { intlLocale } from "@/lib/money";
import { LandingShell } from "@/app/landing-shell";
import { FORMAT_KEYS } from "../filters";

export async function CatalogMarketing({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "catalog" });
  const ta = await getTranslations({ locale, namespace: "advertisers" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const [titleCount, productCount, distinctMarkets, featured] =
    await Promise.all([
      prisma.title.count({ where: { active: true } }),
      prisma.product.count({ where: { active: true } }),
      prisma.title
        .findMany({
          where: { active: true },
          select: { market: { select: { code: true } } },
          distinct: ["marketId"],
        })
        .then((rows) => rows.length),
      prisma.title.findMany({
        where: { active: true },
        orderBy: [{ monthlyReach: "desc" }, { name: "asc" }],
        take: 6,
        include: {
          publisher: { select: { name: true } },
          market: { select: { code: true } },
        },
      }),
    ]);

  return (
    <LandingShell locale={locale} screenLabel="Catalog gate" withFooter={true}>
      <section className="hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("gate.eyebrow")}</span>
          <h1>{t("gate.title", { count: titleCount })}</h1>
          <p className="lead">{t("gate.lead")}</p>
          <div className="hero-actions">
            <Link href="/signup" className="btn large">
              {t("gate.ctaPrimary")}
            </Link>
            <Link href="/signin" className="btn secondary large">
              {t("gate.ctaSecondary")}
            </Link>
          </div>
          <div className="hero-stats">
            <div className="hero-stat">
              <div className="value">{titleCount.toLocaleString(intlLocale(locale))}</div>
              <div className="label">{t("gate.statsTitles")}</div>
            </div>
            <div className="hero-stat">
              <div className="value">{productCount.toLocaleString(intlLocale(locale))}</div>
              <div className="label">{t("gate.statsProducts")}</div>
            </div>
            <div className="hero-stat">
              <div className="value">{distinctMarkets}</div>
              <div className="label">{t("gate.statsMarkets")}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow accent">{ta("formatsEyebrow")}</span>
              <h2>{ta("formatsTitle")}</h2>
            </div>
            <p className="lead" style={{ margin: 0, maxWidth: "44ch" }}>
              {ta("formatsLead")}
            </p>
          </div>
          <div className="grid">
            {FORMAT_KEYS.map((k) => (
              <article className="card" key={k}>
                <h3>{tType(k)}</h3>
                <p className="muted">{tType(`desc${k}`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("gate.teaserEyebrow")}</span>
              <h2>{t("gate.teaserTitle")}</h2>
            </div>
            <Link href="/signup" className="link">
              {t("gate.teaserCta")} →
            </Link>
          </div>
          <div className="grid">
            {featured.map((title) => (
              <article className="card title-card" key={title.id}>
                <span className="tag">{tMarket(title.market.code)}</span>
                <h3>{title.name}</h3>
                <p className="muted">{title.publisher.name}</p>
                {title.category ? (
                  <p className="muted small">{title.category}</p>
                ) : null}
                <p className="muted small" style={{ marginTop: 12 }}>
                  🔒 {t("gate.cardLocked")}
                </p>
              </article>
            ))}
          </div>
          <p className="note" style={{ marginTop: 24 }}>
            {t("gate.teaserFoot", { total: titleCount })}{" "}
            <Link href="/signup" className="link">
              {t("gate.teaserLink")} →
            </Link>
          </p>
        </div>
      </section>

      <section className="section cta-block">
        <div className="wrap">
          <h2>{t("gate.ctaBlockTitle")}</h2>
          <p className="muted">{t("gate.ctaBlockBody")}</p>
          <div className="hero-actions">
            <Link href="/signup" className="btn large">
              {t("gate.ctaPrimary")}
            </Link>
            <Link href="/signin" className="btn secondary large">
              {t("gate.ctaSecondary")}
            </Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
