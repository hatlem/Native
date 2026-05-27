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
  const t = await getTranslations({ locale, namespace: "security" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function SecurityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "security" });

  const pillars = [1, 2, 3, 4].map((i) => ({
    title: t(`pillar${i}Title`),
    body: t(`pillar${i}Body`),
  }));

  return (
    <LandingShell locale={locale} screenLabel="Security">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("pillarsEyebrow")}</span>
              <h2>{t("pillarsTitle")}</h2>
            </div>
          </div>
          <div className="grid">
            {pillars.map((p) => (
              <article className="card" key={p.title}>
                <h3>{p.title}</h3>
                <p className="muted">{p.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("complianceEyebrow")}</span>
              <h2>{t("complianceTitle")}</h2>
            </div>
            <p className="lead">{t("complianceLead")}</p>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("colArea")}</th>
                  <th>{t("colStatus")}</th>
                  <th>{t("colNote")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t("gdprArea")}</td>
                  <td>
                    <span className="badge badge-success">{t("statusYes")}</span>
                  </td>
                  <td className="muted">{t("gdprNote")}</td>
                </tr>
                <tr>
                  <td>{t("dataResArea")}</td>
                  <td>
                    <span className="badge badge-success">{t("statusEu")}</span>
                  </td>
                  <td className="muted">{t("dataResNote")}</td>
                </tr>
                <tr>
                  <td>{t("encryptionArea")}</td>
                  <td>
                    <span className="badge badge-success">{t("statusYes")}</span>
                  </td>
                  <td className="muted">{t("encryptionNote")}</td>
                </tr>
                <tr>
                  <td>{t("ssoArea")}</td>
                  <td>
                    <span className="badge badge-info">{t("statusRoadmap")}</span>
                  </td>
                  <td className="muted">{t("ssoNote")}</td>
                </tr>
                <tr>
                  <td>{t("auditArea")}</td>
                  <td>
                    <span className="badge badge-info">{t("statusPlan")}</span>
                  </td>
                  <td className="muted">{t("auditNote")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("disclosureTitle")}</h2>
          <p className="prose">{t("disclosureBody")}</p>
          <p className="prose">
            {t("disclosureMail")}{" "}
            <MailLink className="link" to="security@nativespin.com" />
          </p>
        </div>
      </section>

      <section className="cta-block">
        <div className="wrap">
          <h2>{t("ctaTitle")}</h2>
          <p>{t("ctaBody")}</p>
          <div className="hero-actions">
            <Link href="/contact" className="btn primary">
              {t("ctaContact")} <span className="arrow">→</span>
            </Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
