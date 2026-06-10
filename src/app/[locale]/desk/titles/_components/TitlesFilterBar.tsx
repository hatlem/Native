import { getTranslations } from "next-intl/server";
import { MarketCode } from "@prisma/client";
import {
  MARKET_CODES,
  STATUS_VALUES,
  NATIVE_FIT_VALUES,
  FORMAT_VALUES,
  B2B_B2C_VALUES,
  REACH_VALUES,
  URL_STATUS_VALUES,
  type StatusFilter,
} from "../filters";

type Props = {
  locale: string;
  market: MarketCode | undefined;
  status: StatusFilter;
  nativeFit: (typeof NATIVE_FIT_VALUES)[number] | undefined;
  format: (typeof FORMAT_VALUES)[number] | undefined;
  b2bB2c: (typeof B2B_B2C_VALUES)[number] | undefined;
  reach: (typeof REACH_VALUES)[number] | undefined;
  urlStatus: (typeof URL_STATUS_VALUES)[number] | undefined;
  vertical: string;
  ownerGroup: string;
  titleType: string;
  frequency: string;
  category: string;
  circulationMin: number | undefined;
  q: string;
};

export async function TitlesFilterBar({
  locale,
  market,
  status,
  nativeFit,
  format,
  b2bB2c,
  reach,
  urlStatus,
  vertical,
  ownerGroup,
  titleType,
  frequency,
  category,
  circulationMin,
  q,
}: Props) {
  const t = await getTranslations({ locale, namespace: "deskTitles" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  return (
    <form className="filters" method="get" style={{ marginTop: 16 }}>
      <div>
        <label htmlFor="market">{t("filters.market")}</label>
        <select id="market" name="market" defaultValue={market ?? ""}>
          <option value="">{t("filters.all")}</option>
          {MARKET_CODES.map((m) => (
            <option key={m} value={m}>
              {tMarket(m)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="status">{t("filters.status")}</label>
        <select id="status" name="status" defaultValue={status}>
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="nativeFit">{t("filters.nativeFit")}</label>
        <select id="nativeFit" name="nativeFit" defaultValue={nativeFit ?? ""}>
          <option value="">{t("filters.all")}</option>
          {NATIVE_FIT_VALUES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="format">{t("filters.format")}</label>
        <select id="format" name="format" defaultValue={format ?? ""}>
          <option value="">{t("filters.all")}</option>
          {FORMAT_VALUES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="b2bB2c">{t("filters.b2bB2c")}</label>
        <select id="b2bB2c" name="b2bB2c" defaultValue={b2bB2c ?? ""}>
          <option value="">{t("filters.all")}</option>
          {B2B_B2C_VALUES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="reach">{t("filters.reach")}</label>
        <select id="reach" name="reach" defaultValue={reach ?? ""}>
          <option value="">{t("filters.all")}</option>
          {REACH_VALUES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="urlStatus">{t("filters.urlStatus")}</label>
        <select id="urlStatus" name="urlStatus" defaultValue={urlStatus ?? ""}>
          <option value="">{t("filters.all")}</option>
          {URL_STATUS_VALUES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="vertical">{t("filters.vertical")}</label>
        <input
          id="vertical"
          name="vertical"
          defaultValue={vertical}
          placeholder={t("filters.verticalPlaceholder")}
        />
      </div>
      <div>
        <label htmlFor="ownerGroup">{t("filters.ownerGroup")}</label>
        <input
          id="ownerGroup"
          name="ownerGroup"
          defaultValue={ownerGroup}
          placeholder={t("filters.ownerGroupPlaceholder")}
        />
      </div>
      <div>
        <label htmlFor="type">{t("filters.type")}</label>
        <input
          id="type"
          name="type"
          defaultValue={titleType}
          placeholder={t("filters.typePlaceholder")}
        />
      </div>
      <div>
        <label htmlFor="frequency">{t("filters.frequency")}</label>
        <input
          id="frequency"
          name="frequency"
          defaultValue={frequency}
          placeholder={t("filters.frequencyPlaceholder")}
        />
      </div>
      <div>
        <label htmlFor="category">{t("filters.category")}</label>
        <input
          id="category"
          name="category"
          defaultValue={category}
          placeholder={t("filters.categoryPlaceholder")}
        />
      </div>
      <div>
        <label htmlFor="circulationMin">{t("filters.circulationMin")}</label>
        <input
          id="circulationMin"
          name="circulationMin"
          type="number"
          min="0"
          defaultValue={circulationMin ?? ""}
          placeholder={t("filters.circulationMinPlaceholder")}
        />
      </div>
      <div>
        <label htmlFor="q">{t("filters.search")}</label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder={t("filters.searchPlaceholder")}
        />
      </div>
      <button type="submit">{t("filters.apply")}</button>
    </form>
  );
}
