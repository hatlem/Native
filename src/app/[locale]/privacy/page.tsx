import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy" });

  const sections = [
    "controller",
    "data",
    "purpose",
    "legal",
    "retention",
    "sharing",
    "transfers",
    "rights",
    "cookies",
    "changes",
  ] as const;

  return (
    <>
      <section className="hero">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
        <p className="muted small">{t("lastUpdated")}</p>
      </section>

      <article className="section" style={{ maxWidth: 720 }}>
        {sections.map((s) => (
          <section key={s} className="section">
            <h2>{t(`${s}.title`)}</h2>
            <p>{t(`${s}.body`)}</p>
          </section>
        ))}

        <section className="section">
          <h2>{t("contactTitle")}</h2>
          <p>
            {t("contactBody")}{" "}
            <a className="link" href="mailto:privacy@benative.example">
              privacy@benative.example
            </a>
          </p>
        </section>
      </article>
    </>
  );
}
