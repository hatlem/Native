import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

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
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      <section className="section prose-section">
        <h2>{t("missionTitle")}</h2>
        <p className="prose">{t("missionBody1")}</p>
        <p className="prose">{t("missionBody2")}</p>
      </section>

      <section className="section prose-section">
        <h2>{t("nordicTitle")}</h2>
        <p className="prose">{t("nordicBody")}</p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t("beliefsTitle")}</h2>
        </div>
        <div className="grid">
          {beliefs.map((b) => (
            <article className="card" key={b.title}>
              <h3>{b.title}</h3>
              <p className="muted">{b.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section prose-section">
        <h2>{t("teamTitle")}</h2>
        <p className="prose">{t("teamBody")}</p>
      </section>

      <section className="section cta-block">
        <h2>{t("contactTitle")}</h2>
        <p className="muted">{t("contactBody")}</p>
        <div className="hero-actions">
          <a href="mailto:hello@benative.example" className="btn large">
            {t("contactCta")}
          </a>
          <Link href="/catalog" className="btn secondary large">
            {tm("browseCatalog")}
          </Link>
        </div>
      </section>
    </>
  );
}
