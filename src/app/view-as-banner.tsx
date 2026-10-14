import { getTranslations } from "next-intl/server";
import { stopViewAs } from "@/app/view-as-actions";

// Shown on every page while a superadmin views the platform as a customer
// (lib/view-as), so it is never unclear whose account is on screen.
export async function ViewAsBanner({ locale, orgName }: { locale: string; orgName: string }) {
  const t = await getTranslations({ locale, namespace: "viewAs" });
  return (
    <div className="view-as-banner" role="status">
      <div className="container view-as-banner__inner">
        <span>
          <strong>{t("bannerTitle", { org: orgName })}</strong> {t("bannerBody")}
        </span>
        <form action={stopViewAs}>
          <input type="hidden" name="locale" value={locale} />
          <button type="submit" className="btn small secondary">
            {t("stop")}
          </button>
        </form>
      </div>
    </div>
  );
}
