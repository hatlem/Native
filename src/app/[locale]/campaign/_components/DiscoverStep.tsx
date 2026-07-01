import { getTranslations } from "next-intl/server";
import { MarketCode } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { addProductToList } from "@/app/list-actions";
import { summarizeReasons, type CampaignRecommendation } from "@/lib/campaign-recommend";

const MARKET_CODES = Object.values(MarketCode);

type Props = {
  locale: string;
  market: string;
  budget: string;
  brief: string;
  recommendation: CampaignRecommendation | null;
};

// Discover: the entry step. Browse links to the full catalog; Recommend runs
// the catalog-grounded brief matcher and shows each pick with a plain-language
// rationale ("why this fits") — the piece Acast's recommender lacks.
export async function DiscoverStep({ locale, market, budget, brief, recommendation }: Props) {
  const t = await getTranslations({ locale, namespace: "campaign" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  // Preserve the current brief when returning from an "add to shortlist" post.
  const returnTo = `/campaign?step=discover${
    market ? `&recMarket=${encodeURIComponent(market)}` : ""
  }${budget ? `&recBudget=${encodeURIComponent(budget)}` : ""}${
    brief ? `&recBrief=${encodeURIComponent(brief)}` : ""
  }`;

  const picks = recommendation?.picks ?? [];
  const supplementary = recommendation?.supplementary ?? [];
  const currency = recommendation?.currency ?? "EUR";
  const briefMatched = recommendation?.briefMatched ?? false;

  return (
    <div className="discover-step">
      <div className="discover-modes">
        <span className="discover-mode is-active">{t("discoverRecommend")}</span>
        <Link className="discover-mode" href="/catalog">
          {t("discoverBrowse")}
        </Link>
      </div>

      <form className="discover-form card" method="get">
        <input type="hidden" name="step" value="discover" />
        <div className="discover-form-row">
          <label>
            <span className="label">{t("fieldMarket")}</span>
            <select name="recMarket" defaultValue={market} required>
              <option value="" disabled>
                {t("fieldMarketPlaceholder")}
              </option>
              {MARKET_CODES.map((code) => (
                <option key={code} value={code}>
                  {tMarket(code)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">{t("fieldBudget")}</span>
            <input
              type="number"
              name="recBudget"
              min="0"
              step="1000"
              defaultValue={budget}
              placeholder={t("fieldBudgetPlaceholder")}
            />
          </label>
        </div>
        <label className="discover-brief">
          <span className="label">{t("fieldBrief")}</span>
          <textarea
            name="recBrief"
            rows={3}
            maxLength={2000}
            defaultValue={brief}
            placeholder={t("fieldBriefPlaceholder")}
          />
        </label>
        <button type="submit" className="btn">
          {t("discoverRun")}
        </button>
      </form>

      {recommendation ? (
        picks.length > 0 || supplementary.length > 0 ? (
          <div className="discover-results">
            {picks.length > 0 ? (
              <>
                <h3>{briefMatched ? t("resultsForBrief") : t("resultsForBudget")}</h3>
                <div className="action-list">
                  {picks.map((p) => {
                    const rationale = summarizeReasons(p.reasons);
                    return (
                      <div className="item" key={p.productId}>
                        <div>
                          <div className="title">
                            <Link href={`/catalog`}>{p.titleName}</Link>
                          </div>
                          <div className="sub muted small">
                            {tType(p.type)} ·{" "}
                            {t("fromPrice", {
                              price: formatMoney(p.unitPrice, currency, locale),
                            })}{" "}
                            · {p.reach.toLocaleString(locale)} {t("reach")}
                          </div>
                          {rationale ? (
                            <div className="discover-why small">
                              <span className="discover-why-label">{t("whyFits")}</span>{" "}
                              {rationale}
                            </div>
                          ) : null}
                        </div>
                        <form action={addProductToList}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="productId" value={p.productId} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <button type="submit" className="btn small">
                            {t("addToShortlist")}
                          </button>
                        </form>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {supplementary.length > 0 ? (
              <>
                <h3>{t("resultsAlsoConsider")}</h3>
                <div className="action-list">
                  {supplementary.map((s) => (
                    <div className="item" key={s.productId}>
                      <div>
                        <div className="title">{s.titleName}</div>
                        <div className="sub muted small">
                          {t("requestPrice")} · {s.reach.toLocaleString(locale)} {t("reach")}
                        </div>
                      </div>
                      <form action={addProductToList}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="productId" value={s.productId} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button type="submit" className="btn small ghost">
                          {t("addToShortlist")}
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <p className="muted discover-empty">{t("resultsEmpty")}</p>
        )
      ) : null}
    </div>
  );
}
