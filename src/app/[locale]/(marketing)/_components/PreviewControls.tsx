"use client";

import { useTranslations } from "next-intl";
import type { MarketCode, Tone } from "@/lib/preview/schema";

export interface MarketOption {
  code: MarketCode;
  name: string;
}

const PRESETS = ["pv-pa", "pv-pb", "pv-pc", "pv-pd", "pv-pe"] as const;

export function PreviewControls({
  brand,
  market,
  tone,
  product,
  markets,
  preset,
  loading,
  onBrand,
  onMarket,
  onTone,
  onProduct,
  onPreset,
  onUpload,
  onGenerate,
}: {
  brand: string;
  market: MarketCode;
  tone: Tone;
  product: string;
  markets: MarketOption[];
  preset: string;
  loading: boolean;
  onBrand: (v: string) => void;
  onMarket: (v: MarketCode) => void;
  onTone: (v: Tone) => void;
  onProduct: (v: string) => void;
  onPreset: (cls: string) => void;
  onUpload: (file: File) => void;
  onGenerate: () => void;
}) {
  const t = useTranslations("landing");
  return (
    <div className="pv-controls">
      <div className="pv-field">
        <label htmlFor="pv-brand">{t("studio.brandLabel")}</label>
        <input id="pv-brand" value={brand} placeholder={t("studio.brandPlaceholder")} onChange={(e) => onBrand(e.target.value)} maxLength={80} />
      </div>
      <div className="pv-row2">
        <div className="pv-field">
          <label htmlFor="pv-market">{t("studio.marketLabel")}</label>
          <select id="pv-market" value={market} onChange={(e) => onMarket(e.target.value as MarketCode)}>
            {markets.map((m) => (
              <option key={m.code} value={m.code}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="pv-field">
          <label htmlFor="pv-tone">{t("studio.toneLabel")}</label>
          <select id="pv-tone" value={tone} onChange={(e) => onTone(e.target.value as Tone)}>
            <option value="warm">{t("studio.toneWarm")}</option>
            <option value="investigative">{t("studio.toneInvestigative")}</option>
            <option value="aspirational">{t("studio.toneAspirational")}</option>
            <option value="plain">{t("studio.tonePlain")}</option>
          </select>
        </div>
      </div>
      <div className="pv-field">
        <label htmlFor="pv-product">{t("studio.productLabel")}</label>
        <textarea id="pv-product" value={product} placeholder={t("studio.productPlaceholder")} onChange={(e) => onProduct(e.target.value)} maxLength={600} />
      </div>
      <button type="button" className="pv-gen" disabled={loading} onClick={onGenerate}>
        {loading ? t("studio.generating") : `✦ ${t("studio.generate")}`}
      </button>
      <div className="pv-field">
        <label>{t("studio.imageLabel")}</label>
        <div className="pv-presets">
          {PRESETS.map((cls) => (
            <button
              key={cls}
              type="button"
              className={`pv-preset ${cls}`}
              aria-pressed={preset === cls}
              aria-label={cls}
              onClick={() => onPreset(cls)}
            />
          ))}
        </div>
        <label className="pv-upload">
          {t("studio.uploadLabel")}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
        </label>
      </div>
    </div>
  );
}
