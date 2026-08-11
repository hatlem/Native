import { getTranslations } from "next-intl/server";

export type PlanStep = 2 | 3 | 4;

// Four-step progress rail: "Find titles" is always done by the time a buyer
// has lines on /plan, so currentStep only ever varies across the remaining
// three — derived in page.tsx from whether a Request/Quote/Order exists yet
// for the active list's most recent submission.
export async function PlanSteps({ locale, currentStep }: { locale: string; currentStep: PlanStep }) {
  const t = await getTranslations({ locale, namespace: "plan.steps" });
  const steps = [1, 2, 3, 4] as const;
  const labels = [t("find"), t("build"), t("quote"), t("approve")];

  return (
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
  );
}
