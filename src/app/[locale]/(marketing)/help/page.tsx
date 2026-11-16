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
  const t = await getTranslations({ locale, namespace: "help" });
  return { title: t("metaTitle"), description: t("lead") };
}

const FAQ = [1, 2, 3, 4, 5, 6] as const;

export default async function HelpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "help" });

  return (
    <LandingShell locale={locale} screenLabel="Help">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </header>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("faqTitle")}</h2>
          {FAQ.map((i) => (
            <details key={i} className="card" style={{ marginBottom: 12 }}>
              <summary>
                <strong>{t(`q${i}`)}</strong>
              </summary>
              <p className="prose" style={{ marginTop: 8 }}>
                {t(`a${i}`)}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="cta-block">
        <div className="wrap">
          <h2>{t("contactTitle")}</h2>
          <p>{t("contactBody")}</p>
          <div className="hero-actions">
            <Link href="/contact" className="btn primary">
              {t("contactCta")} <span className="arrow">→</span>
            </Link>
            <Link href="/changelog" className="btn secondary">
              {t("changelogLink")}
            </Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
