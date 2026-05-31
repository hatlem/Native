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
  const t = await getTranslations({ locale, namespace: "creativeSpecs" });
  return { title: t("metaTitle"), description: t("lead") };
}

const SECTIONS = ["article", "nativePlus", "video"] as const;

export default async function CreativeSpecsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "creativeSpecs" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  return (
    <LandingShell locale={locale} screenLabel="Creative specs">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="grid">
            {SECTIONS.map((s) => (
              <article className="card" key={s}>
                <h2>{t(`${s}.heading`)}</h2>
                <p className="muted">{t(`${s}.body`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("disclosureHeading")}</h2>
          <p className="prose">{t("disclosureBody")}</p>
        </div>
      </section>

      <section className="cta-block">
        <div className="wrap">
          <h2>{t("ctaTitle")}</h2>
          <p>{t("ctaBody")}</p>
          <div className="hero-actions">
            <Link href="/contact" className="btn primary">
              {t("ctaContact")} <span className="arrow">→</span>
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
