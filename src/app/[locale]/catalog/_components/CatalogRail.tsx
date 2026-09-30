"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

type Option = { value: string; label: string };

type Props = {
  markets: Option[];
  // Buyable formats (FORMAT_KEYS) with localized labels: the `types` param.
  formats: Option[];
  nativeFits: Option[];
  b2bB2cs: Option[];
  reaches: Option[];
  categories: Option[];
  regions: Option[];
  // Price-band tiers (the `price` param), labelled in the browsed currencies.
  priceBands: Option[];
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
  // Staged (the mobile sheet): choices collect in a draft and nothing
  // navigates until the sheet's "Apply" does. Unstaged (the desktop rail):
  // every choice navigates at once.
  staged?: boolean;
  // Staged only: the draft query, reported on every change.
  onDraftChange?: (draft: URLSearchParams) => void;
};

const SEARCH_DEBOUNCE_MS = 300;

const list = (v: string | null) => (v ?? "").split(",").filter(Boolean);

// Replaces CatalogFilters.tsx's full-width slab: a 268px rail grouped into
// four plain-language questions instead of a flat row of technical labels.
// Same URL-param model underneath (boolean flags as ?flag=1, multi-selects
// comma-joined) — this only changes how the controls are grouped and worded.
//
// What the controls show is derived from `params` — the query the next
// navigation will carry — so a staged rail (mobile sheet) reflects each tap
// before anything reloads.
export function CatalogRail({
  markets,
  formats,
  nativeFits,
  b2bB2cs,
  reaches,
  categories,
  regions,
  priceBands,
  unpricedCount,
  initial,
  staged = false,
  onDraftChange,
}: Props) {
  const sp = useSearchParams();
  const t = useTranslations("catalog.rail");
  const tf = useTranslations("catalog.filters");

  const [params, setParams] = useState(() => new URLSearchParams(sp.toString()));
  const [q, setQ] = useState(initial.q);
  const [marketOpen, setMarketOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const marketRef = useRef<HTMLDivElement>(null);
  const formatRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);

  // Unstaged: full navigation, not router.replace() — see CatalogSort.tsx
  // for why: same-route RSC soft navigation is currently broken in
  // production. Staged: only the draft changes.
  function commit(updater: (params: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    updater(next);
    next.delete("page");
    if (staged) {
      setParams(next);
      onDraftChange?.(next);
      return;
    }
    window.location.href = `${window.location.pathname}?${next.toString()}`;
  }

  function debouncedSearch(value: string) {
    setQ(value);
    const apply = () =>
      commit((p) => {
        if (value) p.set("q", value);
        else p.delete("q");
      });
    // A staged draft takes the text at once; a live rail waits for a pause.
    if (staged) return apply();
    window.clearTimeout((debouncedSearch as { _t?: number })._t);
    (debouncedSearch as { _t?: number })._t = window.setTimeout(apply, SEARCH_DEBOUNCE_MS);
  }

  function toggleIn(key: string, value: string) {
    const current = list(params.get(key));
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    commit((p) => {
      if (next.length) p.set(key, next.join(","));
      else p.delete(key);
    });
  }
  const toggleMarket = (value: string) => toggleIn("market", value);
  const toggleCategory = (value: string) => toggleIn("vertical", value);
  const togglePrice = (value: string) => toggleIn("price", value);
  const toggleFormat = (value: string) => {
    // Reads the legacy single `type` param too (old shared links), and
    // folds it into `types` on the first change.
    const current = list(params.get("types") ?? params.get("type"));
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    commit((p) => {
      p.delete("type");
      if (next.length) p.set("types", next.join(","));
      else p.delete("types");
    });
  };

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
    if (staged) {
      setQ("");
      const empty = new URLSearchParams();
      setParams(empty);
      onDraftChange?.(empty);
      return;
    }
    window.location.href = window.location.pathname;
  }

  // What the controls show: the draft (staged) or the page's own query.
  const view = {
    markets: list(params.get("market")),
    types: list(params.get("types") ?? params.get("type")),
    verticals: list(params.get("vertical")),
    regions: list(params.get("region")),
    priceTiers: list(params.get("price")),
    nativeFit: params.get("nativeFit") ?? "",
    b2bB2c: params.get("b2bB2c") ?? "",
    onlyPriced: params.get("onlyPriced") === "1",
    producedForYou: params.get("producedForYou") === "1",
    guaranteedReach: params.get("guaranteedReach") === "1",
    newsletterIncluded: params.get("newsletterIncluded") === "1",
    videoIncluded: params.get("videoIncluded") === "1",
    compareMode: params.get("compareMode") === "1",
  };

  const advancedCount = [
    view.nativeFit,
    view.regions.length > 0,
    view.compareMode,
    view.onlyPriced,
  ].filter(Boolean).length;
  const firstLabel = (options: Option[], values: string[]) =>
    values.length > 0
      ? `${options.find((o) => o.value === values[0])?.label ?? values[0]}${values.length > 1 ? ` +${values.length - 1}` : ""}`
      : tf("all");
  const selectedMarkets = new Set(view.markets);
  const primaryMarket = firstLabel(markets, view.markets);
  const selectedFormats = new Set(view.types);
  const primaryFormat = firstLabel(formats, view.types);
  const selectedCategories = new Set(view.verticals);
  const primaryCategory = firstLabel(categories, view.verticals);
  const selectedPrices = new Set(view.priceTiers);
  // Cheapest selected tier first, whatever order they were ticked in.
  const primaryPrice = firstLabel(
    priceBands,
    priceBands.map((p) => p.value).filter((v) => selectedPrices.has(v)),
  );

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
          {selectedMarkets.size === 0
            ? t("marketCountAll", { total: markets.length })
            : t("marketCount", { n: selectedMarkets.size, total: markets.length })}
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
        <h3>{t("formatHeading")}</h3>
        <p className="catalog-rail__hint">{t("formatHint")}</p>
        <div className="catalog-rail__select-box" ref={formatRef}>
          <button
            type="button"
            className="catalog-rail__select-trigger"
            onClick={() => setFormatOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={formatOpen}
          >
            <span>{primaryFormat}</span>
            <span aria-hidden="true">⌄</span>
          </button>
          {formatOpen ? (
            <div className="catalog-rail__popover" role="dialog">
              {formats.map((f) => (
                <label key={f.value} className="catalog-rail__popover-row">
                  <input
                    type="checkbox"
                    checked={selectedFormats.has(f.value)}
                    onChange={() => toggleFormat(f.value)}
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
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
              className={`catalog-rail__segment${view.b2bB2c === v.value ? " is-active" : ""}`}
              onClick={() => setSingle("b2bB2c", v.value)}
            >
              {v.label}
            </button>
          ))}
          <button
            type="button"
            className={`catalog-rail__segment${view.b2bB2c === "" ? " is-active" : ""}`}
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
            checked={view.producedForYou}
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
            checked={view.guaranteedReach}
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
            checked={view.newsletterIncluded}
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
            checked={view.videoIncluded}
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
        <p className="catalog-rail__hint">{t("priceHint")}</p>
        <div className="catalog-rail__select-box">
          <button
            type="button"
            className="catalog-rail__select-trigger"
            onClick={() => setPriceOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={priceOpen}
          >
            <span>{primaryPrice}</span>
            <span aria-hidden="true">⌄</span>
          </button>
          {priceOpen ? (
            <div className="catalog-rail__popover" role="dialog" aria-label={tf("price")}>
              {priceBands.map((p) => (
                <label key={p.value} className="catalog-rail__popover-row">
                  <input
                    type="checkbox"
                    checked={selectedPrices.has(p.value)}
                    onChange={() => togglePrice(p.value)}
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
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
              value={view.nativeFit}
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
                value={view.regions[0] ?? ""}
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
              checked={view.compareMode}
              onChange={(e) => toggleFlag("compareMode", e.target.checked)}
            />
            <span>
              <strong>{tf("compareMode")}</strong>
              <small>{tf("compareModeHint")}</small>
            </span>
          </label>
          <label className="catalog-rail__check">
            <input
              type="checkbox"
              checked={view.onlyPriced}
              onChange={(e) => toggleFlag("onlyPriced", e.target.checked)}
            />
            <span>
              <strong>{tf("onlyPriced")}</strong>
            </span>
          </label>
          {view.onlyPriced && unpricedCount && unpricedCount > 0 ? (
            <p className="catalog-rail__note">{t("unpricedNote", { count: unpricedCount })}</p>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
