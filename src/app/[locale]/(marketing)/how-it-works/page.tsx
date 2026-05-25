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
  const t = await getTranslations({ locale, namespace: "how" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function HowItWorksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "how" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  const steps = [1, 2, 3, 4, 5].map((i) => ({
    title: t(`step${i}Title`),
    body: t(`step${i}Body`),
  }));

  return (
    <LandingShell locale={locale} screenLabel="How it works">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <ol className="step-list">
            {steps.map((s, idx) => (
              <li className="step-item" key={s.title}>
                <div className="step-num" aria-hidden>
                  {String(idx + 1).padStart(2, "0")}
                </div>
                <div>
                  <h3>{s.title}</h3>
                  <p className="muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("eyebrow")}</span>
              <h2>{t("modesTitle")}</h2>
            </div>
          </div>
          <div className="grid">
            <article className="card">
              <span className="badge">⚡ {t("modeFirmTag")}</span>
              <h3>{t("modeFirmTitle")}</h3>
              <p className="muted">{t("modeFirmBody")}</p>
            </article>
            <article className="card">
              <h3>{t("modeRfqTitle")}</h3>
              <p className="muted">{t("modeRfqBody")}</p>
            </article>
          </div>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("contentTitle")}</h2>
          <p className="prose">{t("contentBody")}</p>
        </div>
      </section>

      <section className="cta-block">
        <div className="wrap">
          <h2>{tm("ctaBlockTitle")}</h2>
          <p>{tm("ctaBlockBody")}</p>
          <div className="hero-actions">
            <Link href="/catalog" className="btn primary">
              {tm("browseCatalog")} <span className="arrow">→</span>
            </Link>
            <Link href="/signup" className="btn secondary">
              {tm("createAccount")}
            </Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
