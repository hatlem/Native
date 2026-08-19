import type { CampaignStage } from "@/lib/campaign-stage";

// Six dots joined by lines: done = filled success, current = accent-toned
// (warning for "quote ready", accent for "in production" — same distinction
// the design gives buyer-vs-desk waiting states), upcoming = plain outline.
export function PipelineTrack({
  stage,
  labels,
  currentLabel,
}: {
  stage: CampaignStage;
  labels: [string, string, string, string, string, string];
  currentLabel: string;
}) {
  const steps = [1, 2, 3, 4, 5, 6] as const;
  const currentTone = stage === 3 ? "warning" : "accent";

  return (
    <div className="pipeline-track" role="img" aria-label={currentLabel}>
      {steps.map((n) => (
        <span
          key={n}
          className={`pipeline-track__segment${
            n < stage ? " is-done" : n === stage ? ` is-current is-current--${currentTone}` : ""
          }`}
          aria-hidden="true"
        >
          <span className="pipeline-track__dot" />
          {n < 6 ? <span className="pipeline-track__line" /> : null}
        </span>
      ))}
      <span className="pipeline-track__label">{labels[stage - 1]}</span>
    </div>
  );
}
