import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  const plans = [
    { id: "selfServe", featured: false },
    { id: "managed", featured: true },
    { id: "agency", featured: false },
  ] as const;

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      <section className="section">
        <div className="grid">
          {plans.map((p) => (
            <article
              key={p.id}
              className={`card plan-card ${p.featured ? "is-featured" : ""}`}
            >
              {p.featured ? (
                <span className="badge badge-info dotless plan-badge">
                  {t("recommended")}
                </span>
              ) : null}
              <h3>{t(`plans.${p.id}.name`)}</h3>
              <p className="muted">{t(`plans.${p.id}.tagline`)}</p>
              <div className="price">{t(`plans.${p.id}.price`)}</div>
              <p className="small muted">{t(`plans.${p.id}.priceNote`)}</p>
              <ul className="signup-bullets plan-features">
                {[1, 2, 3, 4].map((i) => (
                  <li key={i}>{t(`plans.${p.id}.feature${i}`)}</li>
                ))}
              </ul>
              <div className="plan-cta">
                <Link
                  href={p.id === "agency" ? "/for-agencies" : "/signup"}
                  className={p.featured ? "btn block" : "btn secondary block"}
                >
                  {t(`plans.${p.id}.cta`)}
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("feesEyebrow")}</span>
            <h2>{t("feesTitle")}</h2>
          </div>
        </div>
        <p className="muted">{t("feesLead")}</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("feesColRole")}</th>
                <th>{t("feesColFee")}</th>
                <th>{t("feesColNote")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t("feesAdvRole")}</td>
                <td>{t("feesAdvFee")}</td>
                <td className="muted">{t("feesAdvNote")}</td>
              </tr>
              <tr>
                <td>{t("feesPubRole")}</td>
                <td>{t("feesPubFee")}</td>
                <td className="muted">{t("feesPubNote")}</td>
              </tr>
              <tr>
                <td>{t("feesContentRole")}</td>
                <td>{t("feesContentFee")}</td>
                <td className="muted">{t("feesContentNote")}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("faqEyebrow")}</span>
            <h2>{t("faqTitle")}</h2>
          </div>
        </div>
        <div className="grid two">
          {[1, 2, 3, 4].map((i) => (
            <article className="card" key={i}>
              <h3>{t(`faq${i}Q`)}</h3>
              <p>{t(`faq${i}A`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section cta-block">
        <h2>{t("ctaTitle")}</h2>
        <p>{t("ctaBody")}</p>
        <div className="hero-actions">
          <Link href="/catalog" className="btn large">
            {tm("browseCatalog")}
          </Link>
          <Link href="/contact" className="btn secondary large">
            {t("ctaContact")}
          </Link>
        </div>
      </section>
    </>
  );
}
