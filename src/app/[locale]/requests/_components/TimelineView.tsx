import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { selectActiveList } from "@/app/list-actions";

// One campaign appearing under a month (or under "Not scheduled yet").
// Everything is pre-translated / pre-formatted by page.tsx — this component
// only lays it out, so it stays a dumb server component with plain props.
export type TimelineEntry = {
  id: string;
  name: string;
  /** Raw status value for StatusBadge (it maps tone + label itself). */
  statusValue: string;
  /** Pre-formatted money, or null when no quote exists yet. */
  totalLabel: string | null;
  /** Pre-translated "Wave n of m", or null when not part of a programme. */
  waveNote: string | null;
  // Same navigation semantics as CampaignRow: order/request entries link to
  // the row view's href; stage-1 drafts have no Request yet, so opening one
  // must first make it the active list via the same server action the plan
  // switcher uses — a plain <Link> can't do that in one step.
  action:
    | { kind: "link"; href: string }
    | { kind: "select-list"; listId: string; locale: string };
};

export type TimelineMonthGroup = {
  /** "YYYY-MM" — stable key. */
  key: string;
  /** Localized "August 2026" heading, formatted by the page. */
  heading: string;
  entries: TimelineEntry[];
};

function EntryBody({ entry }: { entry: TimelineEntry }) {
  return (
    <>
      <span className="requests-timeline__name">{entry.name}</span>
      {entry.waveNote ? <span className="requests-timeline__wave">{entry.waveNote}</span> : null}
      <StatusBadge value={entry.statusValue} />
      {entry.totalLabel ? (
        <span className="requests-timeline__amount">{entry.totalLabel}</span>
      ) : null}
    </>
  );
}

function Entry({ entry }: { entry: TimelineEntry }) {
  if (entry.action.kind === "select-list") {
    return (
      <form className="requests-timeline__form" action={selectActiveList}>
        <input type="hidden" name="listId" value={entry.action.listId} />
        <input type="hidden" name="locale" value={entry.action.locale} />
        <button
          type="submit"
          className="requests-timeline__entry requests-timeline__entry--btn"
        >
          <EntryBody entry={entry} />
        </button>
      </form>
    );
  }
  return (
    <Link href={entry.action.href} className="requests-timeline__entry">
      <EntryBody entry={entry} />
    </Link>
  );
}

function EntryList({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ul className="requests-timeline__list">
      {entries.map((entry) => (
        <li key={entry.id}>
          <Entry entry={entry} />
        </li>
      ))}
    </ul>
  );
}

export function TimelineView({
  lead,
  months,
  unscheduled,
  notScheduledHeading,
  emptyMonthLabel,
}: {
  lead: string;
  months: TimelineMonthGroup[];
  /** Drafts (and undated orders) with no run window — shown after the months. */
  unscheduled: TimelineEntry[];
  notScheduledHeading: string;
  /** Accessible name for the visual "—" placeholder in an empty month. */
  emptyMonthLabel: string;
}) {
  return (
    <div className="requests-timeline">
      <p className="requests-timeline__lead">{lead}</p>

      {months.map((month) => (
        <section key={month.key} className="requests-timeline__month">
          <h2 className="requests-timeline__heading">{month.heading}</h2>
          {month.entries.length === 0 ? (
            // The dash is deliberate: an empty month still gets a line, so
            // the calendar keeps its rhythm and gaps read as gaps, not as a
            // truncated page. Screen readers get the label, not the glyph.
            <p className="requests-timeline__empty" role="note" aria-label={emptyMonthLabel}>
              <span aria-hidden="true">—</span>
            </p>
          ) : (
            <EntryList entries={month.entries} />
          )}
        </section>
      ))}

      {unscheduled.length > 0 ? (
        <section className="requests-timeline__month">
          <h2 className="requests-timeline__heading">{notScheduledHeading}</h2>
          <EntryList entries={unscheduled} />
        </section>
      ) : null}
    </div>
  );
}
