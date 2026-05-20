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
      <section className="hero">
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
        <div className="hero-actions">
          <Link href="/catalog" className="btn">
            {tm("browseCatalog")}
          </Link>
          <Link href="/signup" className="btn secondary">
            {tm("createAccount")}
          </Link>
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("problemsTitle")}</h2>
        <div className="grid">
          {problems.map((p) => (
            <article className="card" key={p.title}>
              <h3>{p.title}</h3>
              <p className="muted">{p.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("solutionsTitle")}</h2>
        <div className="grid">
          {solutions.map((s) => (
            <article className="card" key={s.title}>
              <h3>{s.title}</h3>
              <p className="muted">{s.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("contentTitle")}</h2>
        <p className="muted" style={{ maxWidth: "60ch" }}>
          {t("contentBody")}
        </p>
      </section>

      <section style={{ marginTop: 40, textAlign: "center" }}>
        <h2>{tm("ctaBlockTitle")}</h2>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <Link href="/catalog" className="btn">
            {tm("browseCatalog")}
          </Link>
          <Link href="/recommend" className="btn secondary">
            {tm("tryRecommender")}
          </Link>
        </div>
      </section>
    </>
  );
}
