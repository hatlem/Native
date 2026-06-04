import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";

// Co-located not-found boundary for the title detail route. Catching
// notFound() at the leaf segment (rather than letting it bubble to
// [locale]/not-found, which unwinds through the broad [locale]/loading.tsx
// Suspense and leaves the skeleton stuck on hard loads) renders the 404
// reliably for direct-URL hits on hidden/discontinued/non-existent titles.
export default async function TitleNotFound() {
  const locale = await getLocale();
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
