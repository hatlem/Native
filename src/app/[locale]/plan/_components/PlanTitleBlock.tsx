"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { renameList, selectActiveList, createList } from "@/app/list-actions";

export type PlanListSummary = { id: string; name: string; _count: { items: number } };

// Replaces the old three-group PlanListBar: rename moves inline (a text
// button next to the H1 that reveals a form in place), and create-new moves
// inside the "Switch plan" switcher instead of sitting in its own bar.
// Every control still submits through the existing server actions — this
// only changes how they're grouped and revealed.
export function PlanTitleBlock({
  locale,
  planName,
  activeListId,
  placementCount,
  orgName,
  lastEdited,
  lists,
}: {
  locale: string;
  planName: string;
  activeListId?: string;
  placementCount: number;
  orgName: string | null;
  lastEdited: string;
  lists: PlanListSummary[];
}) {
  const t = useTranslations("plan");
  const [renaming, setRenaming] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  return (
    <div className="plan-title-block">
      <div className="plan-title-block__row">
        {renaming ? (
          <form
            action={renameList}
            className="plan-title-block__rename-form"
            onSubmit={() => setRenaming(false)}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="listId" value={activeListId ?? ""} />
            <input
              type="text"
              name="name"
              defaultValue={planName}
              autoFocus
              className="plan-title-block__rename-input"
              aria-label={t("rename")}
            />
            <button type="submit" className="btn small">
              {t("rename")}
            </button>
            <button type="button" className="btn small ghost" onClick={() => setRenaming(false)}>
              {t("cancel")}
            </button>
          </form>
        ) : (
          <>
            <h1>{planName}</h1>
            <button type="button" className="plan-title-block__rename-btn" onClick={() => setRenaming(true)}>
              {t("rename")}
            </button>
          </>
        )}
        <div className="plan-title-block__switcher" ref={switcherRef}>
          <button
            type="button"
            className="btn small secondary"
            onClick={() => setSwitcherOpen((o) => !o)}
            aria-expanded={switcherOpen}
            aria-haspopup="true"
          >
            {t("switchPlan")}
          </button>
          {switcherOpen ? (
            <div className="plan-title-block__popover" role="dialog">
              <form action={selectActiveList} className="plan-title-block__popover-form">
                <input type="hidden" name="locale" value={locale} />
                <label htmlFor="plan-switch-select">{t("activeList")}</label>
                <select id="plan-switch-select" name="listId" defaultValue={activeListId ?? ""}>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l._count.items})
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn small">
                  {t("switchList")}
                </button>
              </form>
              <form action={createList} className="plan-title-block__popover-form">
                <input type="hidden" name="locale" value={locale} />
                <label htmlFor="plan-switch-new">{t("newList")}</label>
                <input
                  id="plan-switch-new"
                  type="text"
                  name="name"
                  placeholder={t("newListPlaceholder")}
                  required
                />
                <button type="submit" className="btn small secondary">
                  {t("newList")}
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
      <p className="plan-title-block__sub">
        {orgName
          ? t("subline", { count: placementCount, org: orgName, edited: lastEdited })
          : t("sublineNoOrg", { count: placementCount, edited: lastEdited })}
      </p>
    </div>
  );
}
