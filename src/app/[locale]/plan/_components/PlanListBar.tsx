import { getTranslations } from "next-intl/server";
import { createList, selectActiveList, renameList } from "@/app/list-actions";

export type PlanListSummary = {
  id: string;
  name: string;
  _count: { items: number };
};

// Top-of-plan list switcher: pick the active SavedList, rename it inline,
// or spin up a new one. Server-component forms — every control is a real
// submit button, no client JS required.
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
    <div className="plan-list-bar cluster" aria-label={t("savedListsLabel")}>
      <form action={selectActiveList} className="cluster tight">
        <input type="hidden" name="locale" value={locale} />
        <select
          name="listId"
          defaultValue={activeListId ?? ""}
          aria-label={t("savedListsLabel")}
        >
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

      <form action={renameList} className="cluster tight">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="listId" value={activeListId ?? ""} />
        <input
          type="text"
          name="name"
          defaultValue={activeListName ?? ""}
          aria-label={t("rename")}
        />
        <button type="submit" className="btn small ghost">
          {t("rename")}
        </button>
      </form>

      <form action={createList} className="cluster tight">
        <input type="hidden" name="locale" value={locale} />
        <input type="text" name="name" aria-label={t("newList")} />
        <button type="submit" className="btn small">
          {t("newList")}
        </button>
      </form>
    </div>
  );
}
