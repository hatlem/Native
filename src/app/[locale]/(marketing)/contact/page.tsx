import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";
import { MailLink } from "@/components";
import { SafeEmail, withSafeEmails } from "@/components/safe-email";
import { TeamRow } from "./_components/TeamRow";
import { ContactForm } from "./_components/ContactForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });

  const channels = [
    { id: "sales", email: "sales@nativespin.com" },
    { id: "publishers", email: "partners@nativespin.com" },
    { id: "support", email: "support@nativespin.com" },
  ] as const;

  return (
    <LandingShell locale={locale} screenLabel="Contact">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </header>

      <TeamRow locale={locale} />

      <section className="section">
        <div className="wrap">
          <div className="grid">
            {channels.map((c) => (
              <article className="card contact-channel" key={c.id}>
                <h3>{t(`channels.${c.id}.title`)}</h3>
                <p className="muted">{t(`channels.${c.id}.body`)}</p>
                <MailLink className="channel-email" to={c.email}>
                  <SafeEmail address={c.email} />
                </MailLink>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="auth-shell contact-shell">
        <div className="marketing">
          <h2>{t("formTitle")}</h2>
          <p className="lead">{t("formLead")}</p>
          <ul className="signup-bullets">
            <li>{t("bullet1")}</li>
            <li>{t("bullet2")}</li>
            <li>{t("bullet3")}</li>
          </ul>
          <p className="pull">
            <strong>{t("pullTitle")}</strong>
            {withSafeEmails(t("pullBody"))}
          </p>
        </div>

        <ContactForm>
          <p className="alt">
            {t("altPrefix")}{" "}
            <Link href="/about">{t("altLink")}</Link>
          </p>
        </ContactForm>
      </section>
    </LandingShell>
  );
}
