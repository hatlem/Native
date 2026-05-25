import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";

export default async function NotFound() {
  const locale = await getLocale();
  // next-intl v4: the overload without `locale` takes the namespace as a
  // bare string argument.
  const t = await getTranslations("errors");
  const tNav = await getTranslations("nav");

  return (
    <LandingShell locale={locale} screenLabel="Not found">
      <div className="utility-page">
        <span className="utility-code">404</span>
        <h1>{t("notFoundTitle")}</h1>
        <p className="lead">{t("notFoundBody")}</p>
        <div className="cluster">
          <Link href="/" className="btn primary">
            {t("backHome")} <span className="arrow">→</span>
          </Link>
          <Link href="/catalog" className="btn secondary">
            {tNav("catalog")}
          </Link>
        </div>
      </div>
    </LandingShell>
  );
}
