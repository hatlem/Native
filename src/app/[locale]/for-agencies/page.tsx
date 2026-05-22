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
      <section className="hero">
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
        <div className="hero-actions">
          <Link href="/signup" className="btn">
            {tm("createAgencyAccount")}
          </Link>
          <Link href="/catalog" className="btn secondary">
            {tm("browseCatalog")}
          </Link>
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("featuresTitle")}</h2>
        <div className="grid">
          {features.map((f) => (
            <article className="card" key={f.title}>
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("workflowTitle")}</h2>
        <p className="muted" style={{ maxWidth: "60ch" }}>
          {t("workflowBody")}
        </p>
        <p className="note">
          <Link href="/how-it-works">{tm("seeWorkflow")} →</Link>
        </p>
      </section>

      <section style={{ marginTop: 40, textAlign: "center" }}>
        <h2>{t("ctaTitle")}</h2>
        <p className="muted" style={{ maxWidth: "52ch", margin: "0 auto" }}>
          {t("ctaBody")}
        </p>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <Link href="/signup" className="btn">
            {tm("createAgencyAccount")}
          </Link>
        </div>
      </section>
    </>
  );
}
