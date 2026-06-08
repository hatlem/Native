import { getTranslations } from "next-intl/server";

export async function HeroArticleMock({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" });
  return (
    <div className="na-frame" aria-hidden="true">
      <div className="na-bar">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
        <span className="url">{t("preview.mastheadName").toLowerCase()}.example/sponset</span>
      </div>
      <div className="na-masthead">
        <span className="na-name">{t("preview.mastheadName")}</span>
        <span className="na-nav">
          <span>{t("preview.heroNav1")}</span>
          <span>{t("preview.heroNav2")}</span>
          <span>{t("preview.heroNav3")}</span>
        </span>
      </div>
      <div className="na-art">
        <span className="na-tag">● {t("preview.heroTag")}</span>
        <h3>{t("preview.heroHeadline")}</h3>
        <p className="na-standfirst">{t("preview.heroStandfirst")}</p>
        <div className="na-byline">{t("preview.heroByline")}</div>
        <div className="na-photo" />
        <div className="na-cols">
          <i className="f" />
          <i />
          <i />
          <i className="s" />
          <i />
          <i />
          <i className="s" />
          <i />
        </div>
      </div>
    </div>
  );
}
