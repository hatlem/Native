import { getTranslations } from "next-intl/server";

// Status banners above the plan: generic submit error plus the
// duplicate-plan outcomes surfaced via searchParams.
export async function PlanBanners({
  locale,
  error,
  duplicate,
  programme,
}: {
  locale: string;
  error: string | string[] | undefined;
  duplicate: string | string[] | undefined;
  programme?: string | string[] | undefined;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });

  // Map each submit/checkout error code to its OWN message — previously every
  // code rendered the generic "add a placement…" line, actively misleading a
  // rate-limited / permission-denied / list-changed buyer.
  const ERROR_KEYS: Record<string, string> = {
    "1": "error",
    client: "errorClient",
    rate: "errorRate",
    forbidden: "errorForbidden",
    availability: "errorAvailability",
    unavailable: "errorUnavailable",
    changed: "errorChanged",
  };
  const errorCode = Array.isArray(error) ? error[0] : error;
  const errorKey = errorCode ? (ERROR_KEYS[errorCode] ?? "error") : null;

  // startProgramme outcomes: created, or one of ProgrammeError's codes.
  const PROGRAMME_ERROR_KEYS: Record<string, string> = {
    "already-in-programme": "programme.errorAlreadyInProgramme",
    empty: "programme.errorEmpty",
    "not-found": "programme.errorNotFound",
  };
  const programmeCode = Array.isArray(programme) ? programme[0] : programme;

  return (
    <>
      {programmeCode === "created" ? (
        <div className="banner-info" role="status">
          <span>{t("programme.createdBanner")}</span>
        </div>
      ) : programmeCode && PROGRAMME_ERROR_KEYS[programmeCode] ? (
        <div className="banner-error" role="alert">
          <span>{t(PROGRAMME_ERROR_KEYS[programmeCode])}</span>
        </div>
      ) : null}
      {errorKey ? (
        <div className="banner-error" role="alert">
          <span>{t(errorKey)}</span>
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
