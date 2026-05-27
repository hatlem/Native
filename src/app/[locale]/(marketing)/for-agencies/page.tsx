import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";
import { MailLink } from "@/components";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agencies" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function ForAgenciesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agencies" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  const features = [1, 2, 3, 4].map((i) => ({
    title: t(`feature${i}Title`),
    body: t(`feature${i}Body`),
  }));

  return (
    <LandingShell locale={locale} screenLabel="For agencies">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
          <div className="hero-actions">
            <MailLink
              to="partners@nativespin.com"
              subject="Agency access — NativeSpin"
              className="btn primary"
            >
              {tm("requestAgencyAccess")} <span className="arrow">→</span>
            </MailLink>
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
              <span className="eyebrow">{t("featuresEyebrow")}</span>
              <h2>{t("featuresTitle")}</h2>
            </div>
          </div>
          <div className="grid">
            {features.map((f) => (
              <article className="card" key={f.title}>
                <h3>{f.title}</h3>
                <p className="muted">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("workflowTitle")}</h2>
          <p className="prose">{t("workflowBody")}</p>
          <p className="prose">
            <Link href="/how-it-works" className="link">
              {tm("seeWorkflow")} →
            </Link>
          </p>
        </div>
      </section>

      <section className="cta-block">
        <div className="wrap">
          <h2>{t("ctaTitle")}</h2>
          <p>{t("ctaBody")}</p>
          <div className="hero-actions">
            <MailLink
              to="partners@nativespin.com"
              subject="Agency access — NativeSpin"
              className="btn primary"
            >
              {tm("requestAgencyAccess")} <span className="arrow">→</span>
            </MailLink>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
