import { selectActiveList } from "@/app/list-actions";

type Props = {
  locale: string;
  listId: string;
  name: string;
  badgeLabel: string;
  metaLabel: string;
  amountLabel: string | null;
  continueLabel: string;
};

// A single unsent SavedList on the Kampanjer hub. "Continue" reuses the same
// selectActiveList server action PlanListBar's "Bytt liste" dropdown posts
// to — it sets the active-list cookie and redirects straight to /plan.
export function DraftListRow({
  locale,
  listId,
  name,
  badgeLabel,
  metaLabel,
  amountLabel,
  continueLabel,
}: Props) {
  return (
    <div className="item">
      <span className="badge badge-warning dotless">{badgeLabel}</span>
      <div>
        <div className="title">{name}</div>
        <div className="sub">
          {metaLabel}
          {amountLabel ? ` · ${amountLabel}` : ""}
        </div>
      </div>
      <form action={selectActiveList}>
        <input type="hidden" name="listId" value={listId} />
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className="btn small">
          {continueLabel}
        </button>
      </form>
    </div>
  );
}
