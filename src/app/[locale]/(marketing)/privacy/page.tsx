import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LandingShell } from "@/app/landing-shell";
import { MailLink } from "@/components";
import { withSafeEmails } from "@/components/safe-email";

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
    <LandingShell
      locale={locale}
      screenLabel="Privacy"
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
            <p className="prose">{withSafeEmails(t(`${s}.body`))}</p>
          </section>
        ))}

        <section className="legal-section">
          <h2>{t("contactTitle")}</h2>
          <p className="prose">
            {t("contactBody")}{" "}
            <MailLink className="link" to="privacy@nativespin.com" />
          </p>
        </section>
      </article>
    </LandingShell>
  );
}
