import { getTranslations } from "next-intl/server";

export async function NativeVsDisplay({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" });
  return (
    <>
      <div className="vsd" aria-hidden="true">
        <div className="vsd-col good">
          <div className="vsd-label">
            <span className="vsd-tick">✓</span> {t("preview.vsNativeLabel")}
          </div>
          <div className="mini">
            <div className="mini-head">{t("preview.mastheadName")}</div>
            <div className="mini-body">
              <span className="mini-tag">● {t("preview.heroTag")}</span>
              <div className="mini-photo" />
              <h4>{t("preview.vsNativeHeadline")}</h4>
              <i />
              <i />
              <i className="s" />
            </div>
          </div>
        </div>
        <div className="vsd-col bad">
          <div className="vsd-label">
            <span className="vsd-tick">✕</span> {t("preview.vsDisplayLabel")}
          </div>
          <div className="mini">
            <div className="ad" style={{ height: 38 }}>
              {t("preview.vsAdLeaderboard")}
              <span className="adlbl">{t("preview.vsAdTag")}</span>
            </div>
            <div className="mini-head">{t("preview.vsDisplayName")}</div>
            <div className="mini-body">
              <div
                className="ad"
                style={{ height: 54, width: 110, float: "right", margin: "0 0 8px 10px" }}
              >
                {t("preview.vsAdBox")}
                <span className="adlbl">{t("preview.vsAdTag")}</span>
              </div>
              <h4>{t("preview.vsDisplayHeadline")}</h4>
              <i />
              <i />
              <i className="s" />
              <div className="ad" style={{ height: 28, margin: "10px 0" }}>
                {t("preview.vsAdInContent")}
                <span className="adlbl">{t("preview.vsAdTag")}</span>
              </div>
              <i />
              <i className="s" />
              <div className="popup">
                <span className="x">✕</span>
                <strong>{t("preview.vsPopupTitle")}</strong>
                <span className="pbtn">{t("preview.vsPopupCta")}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="vsd-caption" aria-hidden="true">{t("preview.vsCaption")}</p>
    </>
  );
}
