import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LandingShell } from "@/app/landing-shell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "terms" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "terms" });

  const sections = [
    "scope",
    "accounts",
    "roles",
    "orders",
    "content",
    "fees",
    "liability",
    "termination",
    "law",
    "changes",
  ] as const;

  return (
    <LandingShell
      locale={locale}
      screenLabel="Terms"
      rootClassName="legal-doc"
    >
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
          <p className="last-updated">{t("lastUpdated")}</p>
        </div>
      </header>

      <article className="legal-body">
        {sections.map((s) => (
          <section className="legal-section" key={s}>
            <h2>{t(`${s}.title`)}</h2>
            <p className="prose">{t(`${s}.body`)}</p>
          </section>
        ))}

        <section className="legal-section">
          <h2>{t("contactTitle")}</h2>
          <p className="prose">
            {t("contactBody")}{" "}
            <a className="link" href="mailto:legal@atnative.com">
              legal@atnative.com
            </a>
          </p>
        </section>
      </article>
    </LandingShell>
  );
}
