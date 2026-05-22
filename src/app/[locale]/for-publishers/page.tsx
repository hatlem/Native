import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

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
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
        <div className="hero-actions">
          <a href="mailto:partners@benative.example" className="btn large">
            {t("contactCta")}
          </a>
          <Link href="/how-it-works" className="btn secondary large">
            {tm("howCta")}
          </Link>
        </div>
      </header>

      <section className="section">
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
      </section>

      <section className="section">
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
      </section>

      <section className="section prose-section">
        <h2>{t("controlTitle")}</h2>
        <p className="prose">{t("controlBody")}</p>
      </section>

      <section className="section cta-block">
        <h2>{t("ctaTitle")}</h2>
        <p className="muted">{t("ctaBody")}</p>
        <div className="hero-actions">
          <a href="mailto:partners@benative.example" className="btn large">
            {t("contactCta")}
          </a>
        </div>
      </section>
    </>
  );
}
