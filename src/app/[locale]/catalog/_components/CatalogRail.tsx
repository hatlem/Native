"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

type Option = { value: string; label: string };

type Props = {
  markets: Option[];
  nativeFits: Option[];
  b2bB2cs: Option[];
  reaches: Option[];
  categories: Option[];
  regions: Option[];
  unpricedCount: number | null;
  initial: {
    q: string;
    markets: string[];
    types: string[];
    verticals: string[];
    regions: string[];
    nativeFit: string;
    b2bB2c: string;
    reach: string;
    onlyPriced: boolean;
    producedForYou: boolean;
    guaranteedReach: boolean;
    newsletterIncluded: boolean;
    videoIncluded: boolean;
    compareMode: boolean;
  };
};

const SEARCH_DEBOUNCE_MS = 300;

// Replaces CatalogFilters.tsx's full-width slab: a 268px rail grouped into
// four plain-language questions instead of a flat row of technical labels.
// Same URL-param model underneath (boolean flags as ?flag=1, multi-selects
// comma-joined) — this only changes how the controls are grouped and worded.
export function CatalogRail({
  markets,
  nativeFits,
  b2bB2cs,
  reaches,
  categories,
  regions,
  unpricedCount,
  initial,
}: Props) {
  const sp = useSearchParams();
  const t = useTranslations("catalog.rail");
  const tf = useTranslations("catalog.filters");

  const [q, setQ] = useState(initial.q);
  const [marketOpen, setMarketOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const marketRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);

  // Full navigation, not router.replace() — see CatalogSort.tsx for why:
  // same-route RSC soft navigation is currently broken in production.
  function commit(updater: (params: URLSearchParams) => void) {
    const next = new URLSearchParams(sp.toString());
    updater(next);
    next.delete("page");
    window.location.href = `${window.location.pathname}?${next.toString()}`;
  }

  function debouncedSearch(value: string) {
    setQ(value);
    window.clearTimeout((debouncedSearch as { _t?: number })._t);
    (debouncedSearch as { _t?: number })._t = window.setTimeout(() => {
      commit((p) => {
        if (value) p.set("q", value);
        else p.delete("q");
      });
    }, SEARCH_DEBOUNCE_MS);
  }

  function toggleMarket(value: string) {
    const current = sp.get("market")?.split(",").filter(Boolean) ?? [];
    const has = current.includes(value);
    const next = has ? current.filter((v) => v !== value) : [...current, value];
    commit((p) => {
      if (next.length) p.set("market", next.join(","));
      else p.delete("market");
    });
  }

  function toggleCategory(value: string) {
    const current = sp.get("vertical")?.split(",").filter(Boolean) ?? [];
    const has = current.includes(value);
    const next = has ? current.filter((v) => v !== value) : [...current, value];
    commit((p) => {
      if (next.length) p.set("vertical", next.join(","));
      else p.delete("vertical");
    });
  }

  function setSingle(key: string, value: string) {
    commit((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
    });
  }

  function toggleFlag(key: string, checked: boolean) {
    commit((p) => {
      if (checked) p.set(key, "1");
      else p.delete(key);
    });
  }

  function reset() {
    window.location.href = window.location.pathname;
  }

  const advancedCount = [initial.nativeFit, initial.regions.length > 0, initial.compareMode].filter(
    Boolean,
  ).length;
  const selectedMarkets = new Set(initial.markets);
  const primaryMarket =
    initial.markets.length > 0
      ? (markets.find((m) => m.value === initial.markets[0])?.label ?? initial.markets[0])
      : tf("all");
  const selectedCategories = new Set(initial.verticals);
  const primaryCategory =
    initial.verticals.length > 0 ? initial.verticals[0] : tf("all");

  return (
    <aside className="catalog-rail">
      <div className="catalog-rail__head">
        <span className="catalog-rail__eyebrow">{t("heading")}</span>
        <button type="button" className="catalog-rail__reset" onClick={reset}>
          {t("reset")}
        </button>
      </div>

      <input
        type="search"
        className="catalog-rail__search"
        value={q}
        onChange={(e) => debouncedSearch(e.target.value)}
        placeholder={t("searchPlaceholder")}
        aria-label={tf("search")}
        autoComplete="off"
      />

      <div className="catalog-rail__group">
        <h3>{t("whereHeading")}</h3>
        <p className="catalog-rail__hint">{t("whereHint")}</p>
        <div className="catalog-rail__select-box" ref={marketRef}>
          <button
            type="button"
            className="catalog-rail__select-trigger"
            onClick={() => setMarketOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={marketOpen}
          >
            <span>{primaryMarket}</span>
            <span aria-hidden="true">⌄</span>
          </button>
          {marketOpen ? (
            <div className="catalog-rail__popover" role="dialog">
              {markets.map((m) => (
                <label key={m.value} className="catalog-rail__popover-row">
                  <input
                    type="checkbox"
                    checked={selectedMarkets.has(m.value)}
                    onChange={() => toggleMarket(m.value)}
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <p className="catalog-rail__submeta">
          {t("marketCount", { n: Math.max(selectedMarkets.size, 1), total: markets.length })}
          {" · "}
          <button
            type="button"
            className="catalog-rail__link"
            onClick={() => setMarketOpen(true)}
          >
            {t("addAnother")}
          </button>
        </p>
      </div>

      <div className="catalog-rail__group">
        <h3>{t("whoHeading")}</h3>
        <p className="catalog-rail__hint">{t("whoHint")}</p>
        <div className="catalog-rail__select-box" ref={categoryRef}>
          <button
            type="button"
            className="catalog-rail__select-trigger"
            onClick={() => setCategoryOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={categoryOpen}
          >
            <span>{primaryCategory}</span>
            <span aria-hidden="true">⌄</span>
          </button>
          {categoryOpen ? (
            <div className="catalog-rail__popover" role="dialog">
              {categories.map((c) => (
                <label key={c.value} className="catalog-rail__popover-row">
                  <input
                    type="checkbox"
                    checked={selectedCategories.has(c.value)}
                    onChange={() => toggleCategory(c.value)}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <div className="catalog-rail__segmented" role="group" aria-label={tf("b2bB2c")}>
          {b2bB2cs.map((v) => (
            <button
              key={v.value}
              type="button"
              className={`catalog-rail__segment${initial.b2bB2c === v.value ? " is-active" : ""}`}
              onClick={() => setSingle("b2bB2c", v.value)}
            >
              {v.label}
            </button>
          ))}
          <button
            type="button"
            className={`catalog-rail__segment${initial.b2bB2c === "" ? " is-active" : ""}`}
            onClick={() => setSingle("b2bB2c", "")}
          >
            {t("both")}
          </button>
        </div>
      </div>

      <div className="catalog-rail__group">
        <h3>{t("whatHeading")}</h3>
        <p className="catalog-rail__hint">{t("whatHint")}</p>
        <label className="catalog-rail__check">
          <input
            type="checkbox"
            checked={initial.producedForYou}
            onChange={(e) => toggleFlag("producedForYou", e.target.checked)}
          />
          <span>
            <strong>{t("writeLabel")}</strong>
            <small>{t("writeHint")}</small>
          </span>
        </label>
        <label className="catalog-rail__check">
          <input
            type="checkbox"
            checked={initial.guaranteedReach}
            onChange={(e) => toggleFlag("guaranteedReach", e.target.checked)}
          />
          <span>
            <strong>{t("guaranteedLabel")}</strong>
            <small>{t("guaranteedHint")}</small>
          </span>
        </label>
        <label className="catalog-rail__check">
          <input
            type="checkbox"
            checked={initial.newsletterIncluded}
            onChange={(e) => toggleFlag("newsletterIncluded", e.target.checked)}
          />
          <span>
            <strong>{t("newsletterLabel")}</strong>
            <small>{t("newsletterHint")}</small>
          </span>
        </label>
        <label className="catalog-rail__check">
          <input
            type="checkbox"
            checked={initial.videoIncluded}
            onChange={(e) => toggleFlag("videoIncluded", e.target.checked)}
          />
          <span>
            <strong>{t("videoLabel")}</strong>
            <small>{t("videoHint")}</small>
          </span>
        </label>
      </div>

      <div className="catalog-rail__group">
        <h3>{t("priceHeading")}</h3>
        <label className="catalog-rail__check">
          <input
            type="checkbox"
            checked={initial.onlyPriced}
            onChange={(e) => toggleFlag("onlyPriced", e.target.checked)}
          />
          <span>
            <strong>{tf("onlyPriced")}</strong>
          </span>
        </label>
        {initial.onlyPriced && unpricedCount && unpricedCount > 0 ? (
          <p className="catalog-rail__note">{t("unpricedNote", { count: unpricedCount })}</p>
        ) : null}
      </div>

      <button
        type="button"
        className="catalog-rail__advanced-toggle"
        onClick={() => setAdvancedOpen((o) => !o)}
        aria-expanded={advancedOpen}
      >
        {t("advancedToggle", { count: advancedCount })} <span aria-hidden="true">{advancedOpen ? "▴" : "⌄"}</span>
      </button>

      {advancedOpen ? (
        <div className="catalog-rail__advanced">
          <div className="catalog-rail__field">
            <label htmlFor="rail-nativeFit">{tf("nativeFit")}</label>
            <select
              id="rail-nativeFit"
              value={initial.nativeFit}
              onChange={(e) => setSingle("nativeFit", e.target.value)}
            >
              <option value="">{tf("all")}</option>
              {nativeFits.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          {regions.length > 0 ? (
            <div className="catalog-rail__field">
              <label htmlFor="rail-region">{tf("region")}</label>
              <select
                id="rail-region"
                value={initial.regions[0] ?? ""}
                onChange={(e) => setSingle("region", e.target.value)}
              >
                <option value="">{tf("allRegions")}</option>
                {regions.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <label className="catalog-rail__check">
            <input
              type="checkbox"
              checked={initial.compareMode}
              onChange={(e) => toggleFlag("compareMode", e.target.checked)}
            />
            <span>
              <strong>{tf("compareMode")}</strong>
              <small>{tf("compareModeHint")}</small>
            </span>
          </label>
        </div>
      ) : null}
    </aside>
  );
}
