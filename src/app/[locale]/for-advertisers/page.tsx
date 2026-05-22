import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

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

  const problems = [1, 2, 3].map((i) => ({
    title: t(`problem${i}Title`),
    body: t(`problem${i}Body`),
  }));
  const solutions = [1, 2, 3].map((i) => ({
    title: t(`solution${i}Title`),
    body: t(`solution${i}Body`),
  }));

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
        <div className="hero-actions">
          <Link href="/catalog" className="btn large">
            {tm("browseCatalog")}
          </Link>
          <Link href="/signup" className="btn secondary large">
            {tm("createAccount")}
          </Link>
        </div>
      </header>

      <section className="section">
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
      </section>

      <section className="section">
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
      </section>

      <section className="section prose-section">
        <h2>{t("contentTitle")}</h2>
        <p className="prose">{t("contentBody")}</p>
      </section>

      <section className="section cta-block">
        <h2>{tm("ctaBlockTitle")}</h2>
        <p className="muted">{tm("ctaBlockBody")}</p>
        <div className="hero-actions">
          <Link href="/catalog" className="btn large">
            {tm("browseCatalog")}
          </Link>
          <Link href="/recommend" className="btn secondary large">
            {tm("tryRecommender")}
          </Link>
        </div>
      </section>
    </>
  );
}
