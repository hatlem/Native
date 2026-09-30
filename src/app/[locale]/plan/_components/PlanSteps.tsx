import { getTranslations } from "next-intl/server";

export type PlanStep = 2 | 3 | 4;

// Four-step progress rail: "Find titles" is always done by the time a buyer
// has lines on /plan, so currentStep only ever varies across the remaining
// three — derived in page.tsx from whether a Request/Quote/Order exists yet
// for the active list's most recent submission. An instant order (every line
// firm-priced, viewer may order) has no quote step: it is confirmed and then
// runs, so the rail says so.
export async function PlanSteps({
  locale,
  currentStep,
  instant = false,
}: {
  locale: string;
  currentStep: PlanStep;
  instant?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "plan.steps" });
  const steps = [1, 2, 3, 4] as const;
  const labels = instant
    ? [t("find"), t("build"), t("confirm"), t("run")]
    : [t("find"), t("build"), t("quote"), t("approve")];

  return (
    <>
      <ol className="plan-steps" aria-label={t("label")}>
        {steps.map((n, i) => {
          const state = n < currentStep ? "done" : n === currentStep ? "current" : "upcoming";
          return (
            <li key={n} className={`plan-step plan-step--${state}`}>
              <span className="plan-step__circle" aria-hidden="true">
                {state === "done" ? "✓" : n}
              </span>
              <span className="plan-step__label">{labels[i]}</span>
              {n < steps.length ? <span className="plan-step__connector" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>

      {/* Mobile-only: bars instead of circles+labels, per the 2d spec.
          Same data, CSS toggles which of the two renders — no client
          state needed since currentStep never changes without a reload. */}
      <ol className="plan-steps-mobile" aria-label={t("label")}>
        {steps.map((n) => {
          const state = n < currentStep ? "done" : n === currentStep ? "current" : "upcoming";
          return (
            <li key={n} className={`plan-steps-mobile__bar plan-steps-mobile__bar--${state}`}>
              <span className="sr-only">{labels[n - 1]}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
