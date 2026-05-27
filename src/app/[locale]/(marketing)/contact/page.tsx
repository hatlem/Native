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

      <section className="section">
        <div className="wrap">
          <div className="grid">
            {channels.map((c) => (
              <article className="card contact-channel" key={c.id}>
                <h3>{t(`channels.${c.id}.title`)}</h3>
                <p className="muted">{t(`channels.${c.id}.body`)}</p>
                <MailLink className="channel-email" to={c.email}>
                  {c.email}
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
            {t("pullBody")}
          </p>
        </div>

        <form
          className="auth-card"
          action="mailto:hello@nativespin.com"
          method="post"
          encType="text/plain"
        >
          <div className="head">
            <h2>{t("formCardTitle")}</h2>
            <p>{t("formCardLead")}</p>
          </div>
          <div className="field">
            <label htmlFor="contact-name">{t("name")}</label>
            <input id="contact-name" name="name" required autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="contact-email">{t("email")}</label>
            <input
              id="contact-email"
              name="email"
              type="email"
              required
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label htmlFor="contact-org">{t("org")}</label>
            <input id="contact-org" name="organisation" autoComplete="organization" />
          </div>
          <div className="field">
            <label htmlFor="contact-role">{t("role")}</label>
            <select id="contact-role" name="role" defaultValue="advertiser">
              <option value="advertiser">{t("roleAdvertiser")}</option>
              <option value="agency">{t("roleAgency")}</option>
              <option value="publisher">{t("rolePublisher")}</option>
              <option value="other">{t("roleOther")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="contact-message">{t("message")}</label>
            <textarea
              id="contact-message"
              name="message"
              rows={5}
              required
              placeholder={t("messagePlaceholder")}
            />
          </div>
          <div className="actions">
            <button type="submit" className="btn primary block">
              {t("submit")}
            </button>
          </div>
          <p className="alt">
            {t("altPrefix")}{" "}
            <Link href="/about">{t("altLink")}</Link>
          </p>
        </form>
      </section>
    </LandingShell>
  );
}
