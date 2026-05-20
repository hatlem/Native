import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  const beliefs = [1, 2, 3].map((i) => ({
    title: t(`belief${i}Title`),
    body: t(`belief${i}Body`),
  }));

  return (
    <>
      <section className="hero">
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </section>

      <section style={{ marginTop: 32, maxWidth: "70ch" }}>
        <h2>{t("missionTitle")}</h2>
        <p className="muted">{t("missionBody1")}</p>
        <p className="muted">{t("missionBody2")}</p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("nordicTitle")}</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          {t("nordicBody")}
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("beliefsTitle")}</h2>
        <div className="grid">
          {beliefs.map((b) => (
            <article className="card" key={b.title}>
              <h3>{b.title}</h3>
              <p className="muted">{b.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("teamTitle")}</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          {t("teamBody")}
        </p>
      </section>

      <section style={{ marginTop: 40, textAlign: "center" }}>
        <h2>{t("contactTitle")}</h2>
        <p className="muted" style={{ maxWidth: "52ch", margin: "0 auto" }}>
          {t("contactBody")}
        </p>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <a href="mailto:hello@benative.example" className="btn">
            {t("contactCta")}
          </a>
          <Link href="/catalog" className="btn secondary">
            {tm("browseCatalog")}
          </Link>
        </div>
      </section>
    </>
  );
}
