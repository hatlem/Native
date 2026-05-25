import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

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
    <>
      <section className="hero">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </section>

      <section className="section">
        <h2>{t("pillarsTitle")}</h2>
        <div className="grid">
          {pillars.map((p) => (
            <article className="card" key={p.title}>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>{t("complianceTitle")}</h2>
        <p className="muted">{t("complianceLead")}</p>
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
      </section>

      <section className="section">
        <h2>{t("disclosureTitle")}</h2>
        <p>{t("disclosureBody")}</p>
        <p>
          {t("disclosureMail")}{" "}
          <a className="link" href="mailto:security@benative.example">
            security@benative.example
          </a>
        </p>
      </section>

      <section className="section">
        <div className="cta-block">
          <h2>{t("ctaTitle")}</h2>
          <p>{t("ctaBody")}</p>
          <div className="hero-actions">
            <Link href="/contact" className="btn large">
              {t("ctaContact")}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
