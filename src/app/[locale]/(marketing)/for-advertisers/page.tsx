import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProductType } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";
import { PublisherStrip } from "../_components/PublisherStrip";

const FORMAT_KEYS: ProductType[] = [
  ProductType.NATIVE_ARTICLE,
  ProductType.ADVERTORIAL,
  ProductType.NATIVE_DISPLAY,
  ProductType.PACKAGE,
  ProductType.NATIVE_PLUS,
  ProductType.CONTENT_VIDEO,
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "advertisers" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function ForAdvertisersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "advertisers" });
  const tm = await getTranslations({ locale, namespace: "marketing" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const problems = [1, 2, 3].map((i) => ({
    title: t(`problem${i}Title`),
    body: t(`problem${i}Body`),
  }));
  const solutions = [1, 2, 3].map((i) => ({
    title: t(`solution${i}Title`),
    body: t(`solution${i}Body`),
  }));

  return (
    <LandingShell locale={locale} screenLabel="For advertisers">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
          <div className="hero-actions">
            <Link href="/signup" className="btn primary">
              {tm("createAccount")} <span className="arrow">→</span>
            </Link>
            <Link href="/catalog" className="btn secondary">
              {tm("browseCatalog")}
            </Link>
          </div>
        </div>
      </header>

      <PublisherStrip locale={locale} />

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("problemsEyebrow")}</span>
              <h2>{t("problemsTitle")}</h2>
            </div>
          </div>
          <div className="grid">
            {problems.map((p) => (
              <article className="card" key={p.title}>
                <h3>{p.title}</h3>
                <p className="muted">{p.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow accent">{t("solutionsEyebrow")}</span>
              <h2>{t("solutionsTitle")}</h2>
            </div>
          </div>
          <div className="grid">
            {solutions.map((s) => (
              <article className="card" key={s.title}>
                <h3>{s.title}</h3>
                <p className="muted">{s.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow accent">{t("formatsEyebrow")}</span>
              <h2>{t("formatsTitle")}</h2>
            </div>
            <p className="lead">{t("formatsLead")}</p>
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

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("contentTitle")}</h2>
          <p className="prose">{t("contentBody")}</p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow accent">{t("targetingEyebrow")}</span>
              <h2>{t("targetingTitle")}</h2>
            </div>
            <p className="lead">{t("targetingLead")}</p>
          </div>
          <div className="grid">
            <article className="card">
              <h3>{t("targetingContextTitle")}</h3>
              <p className="muted">{t("targetingContextBody")}</p>
            </article>
            <article className="card">
              <h3>{t("targetingGeoTitle")}</h3>
              <p className="muted">{t("targetingGeoBody")}</p>
            </article>
            <article className="card">
              <h3>{t("targetingAudienceTitle")}</h3>
              <p className="muted">{t("targetingAudienceBody")}</p>
            </article>
          </div>
          <p className="prose" style={{ marginTop: 20 }}>
            <strong>{t("targetingHonestyTitle")}: </strong>
            {t("targetingHonestyBody")}
          </p>
        </div>
      </section>

      <section className="cta-block">
        <div className="wrap">
          <h2>{tm("ctaBlockTitle")}</h2>
          <p>{tm("ctaBlockBody")}</p>
          <div className="hero-actions">
            <Link href="/signup" className="btn primary">
              {tm("createAccount")} <span className="arrow">→</span>
            </Link>
            <Link href="/recommend" className="btn secondary">
              {tm("tryRecommender")}
            </Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
