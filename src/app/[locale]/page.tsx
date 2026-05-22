import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  const tNav = await getTranslations({ locale, namespace: "nav" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  const valueProps = [
    { title: t("vp1Title"), body: t("vp1Body") },
    { title: t("vp2Title"), body: t("vp2Body") },
    { title: t("vp3Title"), body: t("vp3Body") },
  ];
  const markets = ["NO", "SE", "DK"] as const;

  // schema.org Organization — gives Google a clean entity to attach the
  // sitelinks searchbox and knowledge-panel to.
  const siteBase =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "";
  const orgLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "BeNative",
    url: siteBase || `/${locale}`,
    areaServed: ["Norway", "Sweden", "Denmark"],
    description: t("subtitle"),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }}
      />
      <section className="hero">
        <h1>{t("title")}</h1>
        <p className="lead">{t("subtitle")}</p>
        <div className="hero-actions">
          <Link href="/catalog" className="btn">
            {t("cta")}
          </Link>
          <Link href="/how-it-works" className="btn secondary">
            {tm("howCta")}
          </Link>
        </div>

        <div className="grid">
          {valueProps.map((vp) => (
            <div className="card" key={vp.title}>
              <h3>{vp.title}</h3>
              <p className="muted">{vp.body}</p>
            </div>
          ))}
        </div>

        <div className="markets">
          {markets.map((m) => (
            <span className="tag" key={m}>
              {tMarket(m)}
            </span>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 48 }}>
        <h2>{tm("audiencesTitle")}</h2>
        <div className="grid">
          {(
            [
              ["for-advertisers", "audAdvertiser"],
              ["for-agencies", "audAgency"],
              ["for-publishers", "audPublisher"],
            ] as const
          ).map(([href, key]) => (
            <article className="card" key={href}>
              <h3>{tm(`${key}Title`)}</h3>
              <p className="muted">{tm(`${key}Body`)}</p>
              <p className="note">
                <Link href={`/${href}`}>{tm("learnMore")} →</Link>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 48, textAlign: "center" }}>
        <h2>{tm("ctaBlockTitle")}</h2>
        <p className="muted" style={{ maxWidth: "52ch", margin: "0 auto" }}>
          {tm("ctaBlockBody")}
        </p>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <Link href="/catalog" className="btn">
            {t("cta")}
          </Link>
          <Link href="/signup" className="btn secondary">
            {tNav("requests")}
          </Link>
        </div>
      </section>
    </>
  );
}
