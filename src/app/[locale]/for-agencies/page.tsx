import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

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
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
        <div className="hero-actions">
          <Link href="/signup" className="btn large">
            {tm("createAgencyAccount")}
          </Link>
          <Link href="/catalog" className="btn secondary large">
            {tm("browseCatalog")}
          </Link>
        </div>
      </header>

      <section className="section">
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
      </section>

      <section className="section prose-section">
        <h2>{t("workflowTitle")}</h2>
        <p className="prose">{t("workflowBody")}</p>
        <p>
          <Link href="/how-it-works" className="link">
            {tm("seeWorkflow")} →
          </Link>
        </p>
      </section>

      <section className="section cta-block">
        <h2>{t("ctaTitle")}</h2>
        <p className="muted">{t("ctaBody")}</p>
        <div className="hero-actions">
          <Link href="/signup" className="btn large">
            {tm("createAgencyAccount")}
          </Link>
        </div>
      </section>
    </>
  );
}
