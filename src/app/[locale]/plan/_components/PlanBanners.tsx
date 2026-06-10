import { getTranslations } from "next-intl/server";

// Status banners above the plan: generic submit error plus the
// duplicate-plan outcomes surfaced via searchParams.
export async function PlanBanners({
  locale,
  error,
  duplicate,
}: {
  locale: string;
  error: string | string[] | undefined;
  duplicate: string | string[] | undefined;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });

  return (
    <>
      {error ? (
        <div className="banner-error" role="alert">
          <span>{t("error")}</span>
        </div>
      ) : null}

      {/* Surfaced by duplicatePlan (Maja R2 / "use as template") so the
          buyer knows how many items survived the rehydration. */}
      {typeof duplicate === "string" ? (
        duplicate === "ok" ? (
          <div className="banner-info" role="status">
            <span>{t("duplicateOk")}</span>
          </div>
        ) : duplicate.startsWith("partial-") ? (
          <div className="banner-info" role="status">
            <span>
              {t("duplicatePartial", {
                dropped: duplicate.slice("partial-".length),
              })}
            </span>
          </div>
        ) : duplicate === "all-inactive" ? (
          <div className="banner-error" role="alert">
            <span>{t("duplicateAllInactive")}</span>
          </div>
        ) : null
      ) : null}
    </>
  );
}
