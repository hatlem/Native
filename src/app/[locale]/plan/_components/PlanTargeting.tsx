import { getTranslations } from "next-intl/server";
import { setListTargetVerticals } from "@/app/list-actions";

// Which verticals THIS plan is targeting — a company running several plans
// (a trucking campaign and a separate seafood campaign, say) can give each
// its own profile instead of one blended signal across everything the org
// has ever touched. Read by the catalog's relevance ranking
// (loadRelevanceSignals) whenever this list is the active one. Native
// <details> — no client JS needed for a disclosure that just shows/hides a
// checkbox grid.
export async function PlanTargeting({
  locale,
  activeListId,
  verticalOptions,
  selected,
}: {
  locale: string;
  activeListId?: string;
  verticalOptions: string[];
  selected: string[];
}) {
  const t = await getTranslations({ locale, namespace: "plan" });
  if (!activeListId || verticalOptions.length === 0) return null;

  const selectedSet = new Set(selected);

  return (
    <details className="plan-targeting">
      <summary className="plan-targeting__summary">
        {t("targetingSummary")}{" "}
        <span className="muted small">
          {selected.length ? selected.join(", ") : t("targetingUnset")}
        </span>
      </summary>
      <form action={setListTargetVerticals} className="plan-targeting__form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="listId" value={activeListId} />
        <p className="muted small">{t("targetingHint")}</p>
        <div className="checkbox-grid">
          {verticalOptions.map((v) => (
            <label key={v} className="checkbox-row">
              <input
                type="checkbox"
                name="targetVerticals"
                value={v}
                defaultChecked={selectedSet.has(v)}
              />
              {v}
            </label>
          ))}
        </div>
        <button type="submit" className="btn small">
          {t("targetingSave")}
        </button>
      </form>
    </details>
  );
}
