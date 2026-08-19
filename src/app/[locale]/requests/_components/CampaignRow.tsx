import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { selectActiveList } from "@/app/list-actions";
import { PipelineTrack } from "./PipelineTrack";
import type { CampaignStage } from "@/lib/campaign-stage";

export type RowAction =
  | { kind: "link"; href: string; label: string; primary: boolean }
  // Stage-1 draft rows have no Request yet — "Continue" sets the active-list
  // cookie via the same server action the plan switcher uses, then lands on
  // /plan. A plain <Link> can't do that in one step.
  | { kind: "select-list"; listId: string; locale: string; label: string };

// "The whole row navigates; the action button stops propagation" (per
// spec) without any client JS: a "stretched link" fills the row at
// z-index 1, and every real interactive element (name link, action
// button/form) sits at z-index 2 so the browser's own hit-testing routes
// their clicks to themselves instead of the row link underneath. This is a
// server component — no onClick/stopPropagation, which would need a
// client boundary this row has no other reason to cross.
export function CampaignRow({
  name,
  statusValue,
  meta,
  stage,
  stageLabels,
  currentStageLabel,
  totalLabel,
  qualifier,
  action,
  footerNote,
  href,
}: {
  name: string;
  statusValue: string;
  meta: string;
  stage: CampaignStage;
  stageLabels: [string, string, string, string, string, string];
  currentStageLabel: string;
  totalLabel: string | null;
  qualifier: string;
  action: RowAction;
  footerNote?: string;
  /** Row-click target — same destination the action button targets. */
  href: string;
}) {
  // Stage-1 draft rows have no Request yet, so "open this row" and "make
  // this the active list" are the same action — clicking anywhere on the
  // row (not just the button) must switch the active list first, or it
  // lands on /plan showing whichever list happened to be active before,
  // not the one that was clicked. A plain <Link> can't run that server
  // action, so the whole row becomes one <form>, with the stretched-link
  // and title rendered as submit buttons instead of <a> tags.
  if (action.kind === "select-list") {
    return (
      <form className="campaign-row" action={selectActiveList}>
        <input type="hidden" name="listId" value={action.listId} />
        <input type="hidden" name="locale" value={action.locale} />
        <button type="submit" className="campaign-row__click" aria-hidden="true" tabIndex={-1} />
        <div className="campaign-row__main">
          <div className="campaign-row__title-row">
            <button type="submit" className="campaign-row__name campaign-row__name-btn">
              {name}
            </button>
            <StatusBadge value={statusValue} />
          </div>
          <div className="campaign-row__meta">{meta}</div>
        </div>

        <PipelineTrack stage={stage} labels={stageLabels} currentLabel={currentStageLabel} />

        <div className="campaign-row__total">
          {totalLabel ? <div className="campaign-row__total-amount">{totalLabel}</div> : null}
          <div className="campaign-row__qualifier">{qualifier}</div>
        </div>

        <div className="campaign-row__action">
          <button type="submit" className="btn small campaign-row__action-btn">
            {action.label}
          </button>
        </div>

        {footerNote ? <div className="campaign-row__footer">{footerNote}</div> : null}
      </form>
    );
  }

  return (
    <div className="campaign-row">
      <Link href={href} className="campaign-row__click" aria-hidden="true" tabIndex={-1} />
      <div className="campaign-row__main">
        <div className="campaign-row__title-row">
          <Link href={href} className="campaign-row__name">
            {name}
          </Link>
          <StatusBadge value={statusValue} />
        </div>
        <div className="campaign-row__meta">{meta}</div>
      </div>

      <PipelineTrack stage={stage} labels={stageLabels} currentLabel={currentStageLabel} />

      <div className="campaign-row__total">
        {totalLabel ? <div className="campaign-row__total-amount">{totalLabel}</div> : null}
        <div className="campaign-row__qualifier">{qualifier}</div>
      </div>

      <div className="campaign-row__action">
        <Link
          href={action.href}
          className={`btn small${action.primary ? "" : " secondary"} campaign-row__action-btn`}
        >
          {action.label}
        </Link>
      </div>

      {footerNote ? <div className="campaign-row__footer">{footerNote}</div> : null}
    </div>
  );
}
