import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations({ namespace: "errors" });
  const tNav = await getTranslations({ namespace: "nav" });

  return (
    <div className="utility-page">
      <span className="utility-code">404</span>
      <h1>{t("notFoundTitle")}</h1>
      <p className="lead">{t("notFoundBody")}</p>
      <div className="cluster">
        <Link href="/" className="btn">
          {t("backHome")}
        </Link>
        <Link href="/catalog" className="btn secondary">
          {tNav("catalog")}
        </Link>
      </div>
    </div>
  );
}
