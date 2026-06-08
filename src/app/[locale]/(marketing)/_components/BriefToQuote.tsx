import { getTranslations } from "next-intl/server";

export async function BriefToQuote({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" });
  return (
    <div className="bq-flow" aria-hidden="true">
      <div className="bq-panel">
        <div className="bq-title">{t("preview.briefTitle")}</div>
        <div className="bq-field">
          <span className="l">{t("preview.briefObjLabel")}</span>
          <div className="v">{t("preview.briefObjValue")}</div>
        </div>
        <div className="bq-row2">
          <div className="bq-field">
            <span className="l">{t("preview.briefMarketsLabel")}</span>
            <div className="v">{t("preview.briefMarketsValue")}</div>
          </div>
          <div className="bq-field">
            <span className="l">{t("preview.briefBudgetLabel")}</span>
            <div className="v">{t("preview.briefBudgetValue")}</div>
          </div>
        </div>
        <div className="bq-field">
          <span className="l">{t("preview.briefDatesLabel")}</span>
          <div className="v">{t("preview.briefDatesValue")}</div>
        </div>
      </div>
      <div className="bq-arrow">→</div>
      <div className="bq-panel">
        <div className="bq-title">{t("preview.quoteTitle")}</div>
        <span className="bq-badge">● {t("preview.quoteBadge")}</span>
        {([1, 2, 3] as const).map((n) => (
          <div className="bq-qrow" key={n}>
            <span>
              <span className="qt">{t(`preview.quoteR${n}Title`)}</span>
              <br />
              <span className="qm">{t(`preview.quoteR${n}Meta`)}</span>
            </span>
            <span className="qp">{t(`preview.quoteR${n}Price`)}</span>
          </div>
        ))}
        <div className="bq-total">
          <span>{t("preview.quoteTotalLabel")}</span>
          <span>{t("preview.quoteTotalValue")}</span>
        </div>
      </div>
    </div>
  );
}
