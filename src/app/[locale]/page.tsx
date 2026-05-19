import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });

  const valueProps = [
    { title: t("vp1Title"), body: t("vp1Body") },
    { title: t("vp2Title"), body: t("vp2Body") },
    { title: t("vp3Title"), body: t("vp3Body") },
  ];

  return (
    <section className="hero">
      <h1>{t("title")}</h1>
      <p className="lead">{t("subtitle")}</p>
      <Link href="/catalog" className="btn">
        {t("cta")}
      </Link>

      <div className="grid">
        {valueProps.map((vp) => (
          <div className="card" key={vp.title}>
            <h3>{vp.title}</h3>
            <p className="muted">{vp.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
