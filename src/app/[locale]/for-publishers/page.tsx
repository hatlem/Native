import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "publishersMkt" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function ForPublishersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "publishersMkt" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  const benefits = [1, 2, 3, 4].map((i) => ({
    title: t(`benefit${i}Title`),
    body: t(`benefit${i}Body`),
  }));
  const steps = [1, 2, 3, 4].map((i) => ({
    title: t(`step${i}Title`),
    body: t(`step${i}Body`),
  }));

  return (
    <>
      <section className="hero">
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
        <div className="hero-actions">
          <a href="mailto:partners@benative.example" className="btn">
            {t("contactCta")}
          </a>
          <Link href="/how-it-works" className="btn secondary">
            {tm("howCta")}
          </Link>
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("benefitsTitle")}</h2>
        <div className="grid">
          {benefits.map((b) => (
            <article className="card" key={b.title}>
              <h3>{b.title}</h3>
              <p className="muted">{b.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("howTitle")}</h2>
        <ol style={{ paddingLeft: 20, maxWidth: "70ch" }}>
          {steps.map((s, idx) => (
            <li key={s.title} style={{ marginBottom: 12 }}>
              <strong>
                {idx + 1}. {s.title}.
              </strong>{" "}
              <span className="muted">{s.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("controlTitle")}</h2>
        <p className="muted" style={{ maxWidth: "60ch" }}>
          {t("controlBody")}
        </p>
      </section>

      <section style={{ marginTop: 40, textAlign: "center" }}>
        <h2>{t("ctaTitle")}</h2>
        <p className="muted" style={{ maxWidth: "52ch", margin: "0 auto" }}>
          {t("ctaBody")}
        </p>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <a href="mailto:partners@benative.example" className="btn">
            {t("contactCta")}
          </a>
        </div>
      </section>
    </>
  );
}
