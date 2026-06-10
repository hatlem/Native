import { getTranslations } from "next-intl/server";
import { MarketCode } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import type { Candidate, SupplementaryTitle } from "@/lib/recommend";
import { addToPlan } from "@/app/plan-actions";
import { SubmitButton } from "@/components";

const MARKET_CODES = Object.values(MarketCode);

// Empty-basket start screen: brief + budget recommender form, with the
// tiered title suggestions rendered alongside once a market is chosen.
export async function PlanStart({
  locale,
  recBriefRaw,
  recMarket,
  recBudgetRaw,
  homeMarket,
  rec,
  recCurrency,
  briefMatched,
}: {
  locale: string;
  recBriefRaw: string;
  recMarket: string;
  recBudgetRaw: string;
  homeMarket: MarketCode | null;
  rec: { picks: Candidate[]; supplementary: SupplementaryTitle[] } | null;
  recCurrency: string;
  briefMatched: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });
  const tr = await getTranslations({ locale, namespace: "rfq" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tv = await getTranslations({
    locale,
    namespace: "priceVisibility",
  });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  return (
    <div className="plan-start">
      <form className="plan-start-form" method="get">
        <h2>{t("startTitle")}</h2>
        <p className="muted small">{t("startLead")}</p>
        <div className="field">
          <label htmlFor="recBrief">{t("briefLabel")}</label>
          <textarea
            id="recBrief"
            name="recBrief"
            rows={3}
            maxLength={2000}
            placeholder={t("briefPlaceholder")}
            defaultValue={recBriefRaw}
          />
          <span className="hint">{t("briefHint")}</span>
        </div>
        <div className="field">
          <label htmlFor="recMarket">{tr("market")}</label>
          <select id="recMarket" name="recMarket" defaultValue={recMarket || homeMarket || ""}>
            {MARKET_CODES.map((m) => (
              <option key={m} value={m}>{tMarket(m)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="recBudget">{tr("budget")}</label>
          <input id="recBudget" name="recBudget" type="number" min="0" defaultValue={recBudgetRaw} />
        </div>
        <SubmitButton label={t("recommend")} pendingLabel={t("recommending")} />
        <Link href="/catalog" className="link small">{t("browse")}</Link>
      </form>

      {rec ? (
        <div className="plan-start-results">
          {rec.picks.length > 0 ? (
            <>
              <h3>{briefMatched ? t("recForBrief") : t("recForBudget")}</h3>
              <div className="action-list">
                {rec.picks.map((p) => (
                  <div className="item" key={p.productId}>
                    <div>
                      <div className="title">{p.titleName}</div>
                      <div className="sub muted small">{tType(p.type)} · {tr("fromPrice", { price: formatMoney(p.unitPrice, recCurrency, locale) })} · {p.reach.toLocaleString(locale)} {t("reach")}</div>
                      {p.reasons && p.reasons.length > 0 ? (
                        <div className="cluster tight" style={{ marginTop: "0.35rem" }}>
                          {p.reasons.slice(0, 4).map((r) => (
                            <span className="tag" key={r}>{r}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <form action={addToPlan}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="productId" value={p.productId} />
                      <button type="submit" className="btn small">{t("add")}</button>
                    </form>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {rec.supplementary.length > 0 ? (
            <>
              <h3>{t("recAlsoConsider")}</h3>
              <div className="action-list">
                {rec.supplementary.map((s) => (
                  <div className="item" key={s.productId}>
                    <div>
                      <div className="title">{s.titleName}</div>
                      <div className="sub muted small">{tv("requestPrice")} · {s.reach.toLocaleString(locale)} {t("reach")}</div>
                    </div>
                    <form action={addToPlan}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="productId" value={s.productId} />
                      <button type="submit" className="btn small ghost">{t("add")}</button>
                    </form>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {rec.picks.length === 0 && rec.supplementary.length === 0 ? (
            <p className="muted small">{t("recNone")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
