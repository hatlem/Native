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
  const t = await getTranslations({ locale, namespace: "publishersMkt" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function ForPublishersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "publishersMkt" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  const benefits = [1, 2, 3, 4].map((i) => ({
    title: t(`benefit${i}Title`),
    body: t(`benefit${i}Body`),
  }));
  const steps = [1, 2, 3, 4].map((i) => ({
    title: t(`step${i}Title`),
    body: t(`step${i}Body`),
  }));

  return (
    <LandingShell locale={locale} screenLabel="For publishers">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
          <div className="hero-actions">
            <a href="mailto:partners@atnative.com" className="btn primary">
              {t("contactCta")} <span className="arrow">→</span>
            </a>
            <Link href="/how-it-works" className="btn secondary">
              {tm("howCta")}
            </Link>
          </div>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("benefitsEyebrow")}</span>
              <h2>{t("benefitsTitle")}</h2>
            </div>
          </div>
          <div className="grid">
            {benefits.map((b) => (
              <article className="card" key={b.title}>
                <h3>{b.title}</h3>
                <p className="muted">{b.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("howEyebrow")}</span>
              <h2>{t("howTitle")}</h2>
            </div>
          </div>
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

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("controlTitle")}</h2>
          <p className="prose">{t("controlBody")}</p>
        </div>
      </section>

      <section className="cta-block">
        <div className="wrap">
          <h2>{t("ctaTitle")}</h2>
          <p>{t("ctaBody")}</p>
          <div className="hero-actions">
            <a href="mailto:partners@atnative.com" className="btn primary">
              {t("contactCta")} <span className="arrow">→</span>
            </a>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
