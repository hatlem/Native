import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { removeListItem } from "@/app/list-actions";
import type { ActiveList } from "@/lib/lists";
import { computeReach } from "@/lib/campaign-estimate";
import { loadPricingDefaults } from "@/lib/content-fee";
import { estimateListTotals, hasFigure } from "@/lib/plan-total";
import { totalLabel } from "@/lib/pricing/total-label";

type Props = {
  locale: string;
  items: ActiveList["items"];
};

// Persistent right rail across every step: the shortlist (SavedList items) plus
// a live per-currency spend + reach estimate. The SavedList is already durable,
// so it *is* the saved draft — no separate save needed.
//
// Spend comes from the engine every plan surface shares (lib/plan-total.ts):
// content fees included, exact only for instant-orderable lines and a price
// band for the rest — the same figure /plan shows for this list.
export async function ShortlistRail({ locale, items }: Props) {
  const t = await getTranslations({ locale, namespace: "campaign" });
  const tv = await getTranslations({ locale, namespace: "priceVisibility" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const rows = items.map((i) => {
    if (i.product) {
      const p = i.product;
      return {
        key: i.id,
        titleName: p.title.name,
        typeLabel: tType(p.type),
        quantity: i.quantity,
        titleId: p.titleId,
        reach: p.title.digitalReach ?? p.title.monthlyReach ?? 0,
      };
    }
    // Title placeholder — desk prices it later; counts toward reach only.
    return {
      key: i.id,
      titleName: i.title?.name ?? "—",
      typeLabel: t("titlePlaceholder"),
      quantity: i.quantity,
      titleId: i.titleId ?? i.id,
      reach: i.title?.digitalReach ?? i.title?.monthlyReach ?? 0,
    };
  });

  const estimate = computeReach(rows);
  const totals = estimateListTotals(items, await loadPricingDefaults()).sort(
    (a, b) => Number(!hasFigure(a)) - Number(!hasFigure(b)),
  );

  return (
    <aside className="shortlist-rail" aria-label={t("shortlistTitle")}>
      <div className="shortlist-rail-head">
        <h2>{t("shortlistTitle")}</h2>
        <span className="shortlist-count">{estimate.itemCount}</span>
      </div>

      {rows.length === 0 ? (
        <p className="muted small">{t("shortlistEmpty")}</p>
      ) : (
        <ul className="shortlist-items">
          {rows.map((r) => (
            <li key={r.key} className="shortlist-item">
              <div>
                <div className="shortlist-item-title">{r.titleName}</div>
                <div className="muted small">
                  {r.typeLabel}
                  {r.quantity > 1 ? ` · ×${r.quantity}` : ""}
                </div>
              </div>
              <form action={removeListItem}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="itemId" value={r.key} />
                <button
                  type="submit"
                  className="shortlist-remove"
                  aria-label={t("shortlistRemove")}
                >
                  ×
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <div className="shortlist-estimate">
        <div className="shortlist-estimate-label">{t("estimateTitle")}</div>
        {totals.length > 0 ? (
          totals.map((tot) => (
            <div key={tot.currency} className="shortlist-estimate-row">
              <span>{tot.currency}</span>
              <span>
                {totalLabel(tot, locale) ?? tv("priceOnRequest")}
                {hasFigure(tot) && tot.hasOnRequest ? ` ${tv("plusOnRequest")}` : ""}
              </span>
            </div>
          ))
        ) : (
          <div className="shortlist-estimate-row muted">
            <span>—</span>
          </div>
        )}
        {estimate.reach > 0 ? (
          <div className="shortlist-estimate-row">
            <span>{t("estimateReach")}</span>
            <span>{estimate.reach.toLocaleString(locale)}</span>
          </div>
        ) : null}
        <p className="muted xsmall">{t("estimateNote")}</p>
      </div>

      {estimate.itemCount > 0 ? (
        <Link href="/campaign?step=schedule" className="btn shortlist-continue">
          {t("continueToSchedule")}
        </Link>
      ) : null}
    </aside>
  );
}
