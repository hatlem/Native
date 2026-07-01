import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { indicativeFromRules, toRateRules } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { removeListItem } from "@/app/list-actions";
import type { ActiveList } from "@/lib/lists";
import { computeEstimate, type EstimateLine } from "@/lib/campaign-estimate";

type Props = {
  locale: string;
  items: ActiveList["items"];
};

// Persistent right rail across every step: the shortlist (SavedList items) plus
// a live per-currency spend + reach estimate. The SavedList is already durable,
// so it *is* the saved draft — no separate save needed.
export async function ShortlistRail({ locale, items }: Props) {
  const t = await getTranslations({ locale, namespace: "campaign" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const rows = items.map((i) => {
    if (i.product) {
      const p = i.product;
      const priceVisible = isProductPriceShown(p, p.title);
      const unit = priceVisible
        ? indicativeFromRules(Number(p.basePrice), toRateRules(p.priceRules), i.quantity)
        : 0;
      const reach = p.title.digitalReach ?? p.title.monthlyReach ?? 0;
      return {
        key: i.id,
        titleName: p.title.name,
        typeLabel: tType(p.type),
        quantity: i.quantity,
        line: {
          currency: p.currency,
          lineTotal: unit * i.quantity,
          priceVisible,
          titleId: p.titleId,
          reach,
        } as EstimateLine,
      };
    }
    // Title placeholder — desk prices it later; counts toward reach only.
    const reach = i.title?.digitalReach ?? i.title?.monthlyReach ?? 0;
    return {
      key: i.id,
      titleName: i.title?.name ?? "—",
      typeLabel: t("titlePlaceholder"),
      quantity: i.quantity,
      line: null as EstimateLine | null,
      reach,
    };
  });

  const estimate = computeEstimate(
    rows
      .map((r) => r.line ?? null)
      .filter((l): l is EstimateLine => l !== null)
      .concat(
        // include placeholder reach as a hidden-price line so reach reflects it
        rows
          .filter((r) => !r.line)
          .map((r) => ({
            currency: "",
            lineTotal: 0,
            priceVisible: false,
            titleId: r.key,
            reach: (r as { reach?: number }).reach ?? 0,
          })),
      ),
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
        {estimate.totals.filter((tot) => tot.currency).length > 0 ? (
          estimate.totals
            .filter((tot) => tot.currency)
            .map((tot) => (
              <div key={tot.currency} className="shortlist-estimate-row">
                <span>{tot.currency}</span>
                <span>
                  {tot.hasVisible
                    ? formatMoney(tot.amount, tot.currency, locale)
                    : t("requestPrice")}
                  {tot.hasVisible && tot.hasHidden ? ` + ${t("plusRequest")}` : ""}
                </span>
              </div>
            ))
        ) : (
          <div className="shortlist-estimate-row muted">
            <span>—</span>
          </div>
        )}
        <div className="shortlist-estimate-row">
          <span>{t("estimateReach")}</span>
          <span>{estimate.reach.toLocaleString(locale)}</span>
        </div>
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
