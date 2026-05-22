import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "how" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function HowItWorksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "how" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  const steps = [1, 2, 3, 4, 5].map((i) => ({
    title: t(`step${i}Title`),
    body: t(`step${i}Body`),
  }));

  return (
    <>
      <section className="hero">
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </section>

      <section style={{ marginTop: 32 }}>
        <div className="grid">
          {steps.map((s, idx) => (
            <article className="card" key={s.title}>
              <div
                aria-hidden="true"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  background: "var(--primary-soft)",
                  color: "var(--primary-hover)",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 700,
                  marginBottom: 8,
                }}
              >
                {idx + 1}
              </div>
              <h3>{s.title}</h3>
              <p className="muted">{s.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("modesTitle")}</h2>
        <div className="grid">
          <article className="card">
            <h3>
              <span className="tag" style={{ marginRight: 8 }}>
                ⚡ {t("modeFirmTag")}
              </span>
              {t("modeFirmTitle")}
            </h3>
            <p className="muted">{t("modeFirmBody")}</p>
          </article>
          <article className="card">
            <h3>{t("modeRfqTitle")}</h3>
            <p className="muted">{t("modeRfqBody")}</p>
          </article>
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>{t("contentTitle")}</h2>
        <p className="muted" style={{ maxWidth: "60ch" }}>
          {t("contentBody")}
        </p>
      </section>

      <section style={{ marginTop: 40, textAlign: "center" }}>
        <h2>{tm("ctaBlockTitle")}</h2>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <Link href="/catalog" className="btn">
            {tm("browseCatalog")}
          </Link>
          <Link href="/signup" className="btn secondary">
            {tm("createAccount")}
          </Link>
        </div>
      </section>
    </>
  );
}
