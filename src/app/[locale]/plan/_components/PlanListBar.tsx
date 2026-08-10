import { getTranslations } from "next-intl/server";
import { createList, selectActiveList, renameList } from "@/app/list-actions";

export type PlanListSummary = {
  id: string;
  name: string;
  _count: { items: number };
};

// Top-of-plan list switcher: pick the active SavedList, rename it inline,
// or spin up a new one. Server-component forms — every control is a real
// submit button, no client JS required. Each control sits in its own
// labeled group (visible label, not just aria-label) so the bar reads as
// three deliberate fields instead of three unexplained inputs.
export async function PlanListBar({
  locale,
  lists,
  activeListId,
  activeListName,
}: {
  locale: string;
  lists: PlanListSummary[];
  activeListId?: string;
  activeListName?: string;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });

  return (
    <div className="plan-list-bar" role="group" aria-label={t("savedListsLabel")}>
      <div className="plan-list-bar-group">
        <label htmlFor="plan-list-select">{t("activeList")}</label>
        <form action={selectActiveList} className="plan-list-bar-controls">
          <input type="hidden" name="locale" value={locale} />
          <select id="plan-list-select" name="listId" defaultValue={activeListId ?? ""}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l._count.items})
              </option>
            ))}
          </select>
          <button type="submit" className="btn small ghost">
            {t("switchList")}
          </button>
        </form>
      </div>

      <div className="plan-list-bar-group">
        <label htmlFor="plan-list-rename">{t("rename")}</label>
        <form action={renameList} className="plan-list-bar-controls">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="listId" value={activeListId ?? ""} />
          <input
            id="plan-list-rename"
            type="text"
            name="name"
            defaultValue={activeListName ?? ""}
            placeholder={t("renamePlaceholder")}
          />
          <button type="submit" className="btn small ghost">
            {t("rename")}
          </button>
        </form>
      </div>

      <div className="plan-list-bar-group">
        <label htmlFor="plan-list-new">{t("newList")}</label>
        <form action={createList} className="plan-list-bar-controls">
          <input type="hidden" name="locale" value={locale} />
          <input
            id="plan-list-new"
            type="text"
            name="name"
            placeholder={t("newListPlaceholder")}
            required
          />
          <button type="submit" className="btn small">
            {t("newList")}
          </button>
        </form>
      </div>
    </div>
  );
}
