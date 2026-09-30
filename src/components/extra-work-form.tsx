import { SubmitButton } from "./submit-button";
import { EXTRA_WORK_DESCRIPTION_MAX } from "@/lib/pricing/extra-work";

// The desk's "Extra work / revision" form: hours (quarter-hour steps) and a
// description, billed at the currency's hourly rate. Shared by the draft
// quote (quote-actions addQuoteExtraWork) and the order (desk-billing-actions
// addOrderExtraWorkAction), which differ only in the action, the hidden ids
// and the lead text. Validation is the server's (lib/pricing/extra-work.ts);
// the input attributes only guide typing.
export function ExtraWorkForm({
  action,
  hidden,
  lead,
  noRate,
  error,
  labels,
}: {
  action: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  // "…at NOK 1,650/hour (NOK)". Null when the currency has no rate: then the
  // form is replaced by `noRate`, since nothing can be billed.
  lead: string | null;
  noRate: string;
  error: string | null;
  labels: {
    heading: string;
    hours: string;
    hoursHint: string;
    description: string;
    descriptionPlaceholder: string;
    add: string;
    adding: string;
  };
}) {
  // Unique per form: a request with several draft quotes renders several.
  const hintId = `extra-work-hours-${Object.values(hidden).join("-")}`;
  return (
    <details className="extra-work" open={error ? true : undefined}>
      <summary>{labels.heading}</summary>
      {lead === null ? (
        <p className="muted small">{noRate}</p>
      ) : (
        <form action={action} className="extra-work__form stack-4">
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <p className="muted small">{lead}</p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="grid two">
            <label className="field">
              <span>{labels.hours}</span>
              <input
                name="hours"
                inputMode="decimal"
                required
                pattern="[0-9]+([.,](0|00|25|5|50|75))?"
                maxLength={6}
                placeholder="1,5"
                aria-describedby={hintId}
                title={labels.hoursHint}
              />
              <span className="muted small" id={hintId}>
                {labels.hoursHint}
              </span>
            </label>
            <label className="field">
              <span>{labels.description}</span>
              <input
                name="description"
                required
                maxLength={EXTRA_WORK_DESCRIPTION_MAX}
                placeholder={labels.descriptionPlaceholder}
              />
            </label>
          </div>
          <SubmitButton className="btn small" label={labels.add} pendingLabel={labels.adding} />
        </form>
      )}
    </details>
  );
}
