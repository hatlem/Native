import { getTranslations } from "next-intl/server";

export async function GoldenRuleExcerpt({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" });
  return (
    <div className="rule-excerpt" aria-hidden="true">
      <div className="re-tag">{t("preview.ruleExcerptTag")}</div>
      <p>
        <span className="re-cap">{t("preview.ruleExcerptCap")}</span>
        {t("preview.ruleExcerptBody")}
      </p>
    </div>
  );
}
