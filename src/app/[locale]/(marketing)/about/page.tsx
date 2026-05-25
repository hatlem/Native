import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  const beliefs = [1, 2, 3].map((i) => ({
    title: t(`belief${i}Title`),
    body: t(`belief${i}Body`),
  }));

  return (
    <LandingShell locale={locale} screenLabel="About">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </header>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("missionTitle")}</h2>
          <p className="prose">{t("missionBody1")}</p>
          <p className="prose">{t("missionBody2")}</p>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("nordicTitle")}</h2>
          <p className="prose">{t("nordicBody")}</p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("eyebrow")}</span>
              <h2>{t("beliefsTitle")}</h2>
            </div>
          </div>
          <div className="grid">
            {beliefs.map((b) => (
              <article className="card" key={b.title}>
                <h3>{b.title}</h3>
                <p className="muted">{b.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("teamTitle")}</h2>
          <p className="prose">{t("teamBody")}</p>
        </div>
      </section>

      <section className="cta-block">
        <div className="wrap">
          <h2>{t("contactTitle")}</h2>
          <p>{t("contactBody")}</p>
          <div className="hero-actions">
            <a href="mailto:hello@atnative.com" className="btn primary">
              {t("contactCta")} <span className="arrow">→</span>
            </a>
            <Link href="/catalog" className="btn secondary">
              {tm("browseCatalog")}
            </Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
