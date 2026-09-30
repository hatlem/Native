import { getTranslations } from "next-intl/server";

// Status banners above the plan: generic submit error plus the
// duplicate-plan outcomes surfaced via searchParams.
export async function PlanBanners({
  locale,
  error,
  duplicate,
  notice,
}: {
  locale: string;
  error: string | string[] | undefined;
  duplicate: string | string[] | undefined;
  // Set by /plan/open when the requested plan couldn't be opened and the
  // viewer was sent to their current plan instead.
  notice?: string | string[] | undefined;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });

  // Map each submit/checkout error code to its OWN message — previously every
  // code rendered the generic "add a placement…" line, actively misleading a
  // rate-limited / permission-denied / list-changed buyer.
  const ERROR_KEYS: Record<string, string> = {
    "1": "error",
    empty: "errorEmpty",
    client: "errorClient",
    rate: "errorRate",
    forbidden: "errorForbidden",
    availability: "errorAvailability",
    unavailable: "errorUnavailable",
    changed: "errorChanged",
    "note-too-long": "errorNoteTooLong",
  };
  const errorCode = Array.isArray(error) ? error[0] : error;
  const errorKey = errorCode ? (ERROR_KEYS[errorCode] ?? "error") : null;

  const noticeCode = Array.isArray(notice) ? notice[0] : notice;
  const noticeKey =
    noticeCode === "plan-archived"
      ? "noticePlanArchived"
      : noticeCode === "plan-unavailable"
        ? "noticePlanUnavailable"
        : // A view-only seat posted a change (lib/plan-target: in scope, not
          // editable): nothing happened, and this says why.
          noticeCode === "plan-read-only"
          ? "noticePlanReadOnly"
          : null;

  return (
    <>
      {noticeKey ? (
        <div className="banner-info" role="status">
          <span>{t(noticeKey)}</span>
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
