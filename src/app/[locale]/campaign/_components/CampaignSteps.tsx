// Progress indicator for the guided campaign flow. Pure, server-rendered.
// Steps are a static indicator in Phase 0 — inter-step navigation arrives
// once each step persists its own state.

export type CampaignStep = "discover" | "shortlist" | "schedule" | "proposal";

export type CampaignStepDef = { key: CampaignStep; label: string };

export function CampaignSteps({
  steps,
  current,
  label,
}: {
  steps: readonly CampaignStepDef[];
  current: CampaignStep;
  label: string;
}) {
  const currentIndex = steps.findIndex((s) => s.key === current);

  return (
    <nav className="campaign-steps" aria-label={label}>
      <ol>
        {steps.map((step, i) => {
          const state =
            i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
          return (
            <li
              key={step.key}
              className={`campaign-step is-${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className="campaign-step-index" aria-hidden="true">
                {i + 1}
              </span>
              <span className="campaign-step-label">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
