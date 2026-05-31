"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

type Option = { value: string; label: string };

type Props = {
  markets: Option[];
  formats: Option[];
  nativeFits: Option[];
  b2bB2cs: Option[];
  reaches: Option[];
  categories: Option[];
  initial: {
    q: string;
    markets: string[];
    types: string[];
    verticals: string[];
    nativeFit: string;
    b2bB2c: string;
    reach: string;
    onlyPriced: boolean;
    advancedOpen: boolean;
    compareMode: boolean;
  };
};

const SEARCH_DEBOUNCE_MS = 300;

export function CatalogFilters({ markets, formats, nativeFits, b2bB2cs, reaches, categories, initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const t = useTranslations("catalog.filters");

  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(initial.q);
  const [formatOpen, setFormatOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(initial.advancedOpen);
  const formatRef = useRef<HTMLDivElement>(null);
  const marketRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);

  // Debounced URL update for the search input. Other filter changes
  // commit instantly — only the text field waits for the typist to pause.
  useEffect(() => {
    if (q === initial.q) return;
    const id = setTimeout(() => {
      const next = new URLSearchParams(sp.toString());
      if (q) next.set("q", q);
      else next.delete("q");
      next.delete("page");
      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Close the format popover when clicking outside.
  useEffect(() => {
    if (!formatOpen) return;
    function onDown(e: MouseEvent) {
      if (formatRef.current && !formatRef.current.contains(e.target as Node)) {
        setFormatOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [formatOpen]);

  // Same outside-click handling for the market popover.
  useEffect(() => {
    if (!marketOpen) return;
    function onDown(e: MouseEvent) {
      if (marketRef.current && !marketRef.current.contains(e.target as Node)) {
        setMarketOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [marketOpen]);

  // Same outside-click handling for the category popover.
  useEffect(() => {
    if (!categoryOpen) return;
    function onDown(e: MouseEvent) {
      if (categoryRef.current && !categoryRef.current.contains(e.target as Node)) {
        setCategoryOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [categoryOpen]);

  function commit(updater: (params: URLSearchParams) => void) {
    const next = new URLSearchParams(sp.toString());
    updater(next);
    next.delete("page");
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  function setSingle(key: string, value: string) {
    commit((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
    });
  }

  function toggleFormat(value: string) {
    const current = sp.get("types")?.split(",").filter(Boolean) ?? [];
    const has = current.includes(value);
    const nextValues = has
      ? current.filter((v) => v !== value)
      : [...current, value];
    commit((p) => {
      if (nextValues.length) p.set("types", nextValues.join(","));
      else p.delete("types");
    });
  }

  function clearFormats() {
    commit((p) => p.delete("types"));
  }

  function toggleMarket(value: string) {
    const current = sp.get("market")?.split(",").filter(Boolean) ?? [];
    const has = current.includes(value);
    const nextValues = has
      ? current.filter((v) => v !== value)
      : [...current, value];
    commit((p) => {
      if (nextValues.length) p.set("market", nextValues.join(","));
      else p.delete("market");
    });
  }

  function clearMarkets() {
    commit((p) => p.delete("market"));
  }

  function toggleCategory(value: string) {
    const current = sp.get("vertical")?.split(",").filter(Boolean) ?? [];
    const has = current.includes(value);
    const nextValues = has
      ? current.filter((v) => v !== value)
      : [...current, value];
    commit((p) => {
      if (nextValues.length) p.set("vertical", nextValues.join(","));
      else p.delete("vertical");
    });
  }

  function clearCategories() {
    commit((p) => p.delete("vertical"));
  }

  function toggleOnlyPriced(checked: boolean) {
    commit((p) => {
      if (checked) p.set("onlyPriced", "1");
      else p.delete("onlyPriced");
    });
  }

  function toggleCompareMode(checked: boolean) {
    commit((p) => {
      if (checked) p.set("compareMode", "1");
      else p.delete("compareMode");
    });
  }

  const selectedTypes = new Set(initial.types);
  const formatLabel = t("formatCount", { count: selectedTypes.size });
  const selectedMarkets = new Set(initial.markets);
  // Show the actual single-market label when only one is chosen so the
  // common case stays as readable as a single-select dropdown — fall back
  // to a count for multi-select state.
  const marketLabel =
    selectedMarkets.size === 0
      ? t("all")
      : selectedMarkets.size === 1
        ? (markets.find((m) => m.value === initial.markets[0])?.label ?? initial.markets[0])
        : t("marketCount", { count: selectedMarkets.size });
  const selectedCategories = new Set(initial.verticals);
  const selectedRegions = new Set(initial.regions);
  const categoryLabel = t("categoryCount", { count: selectedCategories.size });

  return (
    <div className="catalog-filters">
      {/* Search comes first — it carries the most filter intent and the
          full-width row signals it's the primary entry point. */}
      <div className="catalog-filters__search">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("search")}
          autoComplete="off"
        />
        {isPending ? (
          <span className="catalog-filters__pending" aria-live="polite">
            {t("loading")}
          </span>
        ) : null}
      </div>

      <div className="catalog-filters__row">
        <div className="catalog-filters__field">
          <label>{t("market")}</label>
          <div className="catalog-filters__multi" ref={marketRef}>
            <button
              type="button"
              className="catalog-filters__multi-trigger"
              onClick={() => setMarketOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={marketOpen}
            >
              <span>{marketLabel}</span>
              <span aria-hidden="true" className="catalog-filters__chev">
                ⌄
              </span>
            </button>
            {marketOpen ? (
              <div className="catalog-filters__popover" role="dialog">
                {markets.map((m) => (
                  <label key={m.value} className="catalog-filters__popover-row">
                    <input
                      type="checkbox"
                      checked={selectedMarkets.has(m.value)}
                      onChange={() => toggleMarket(m.value)}
                    />
                    <span>{m.label}</span>
                  </label>
                ))}
                {selectedMarkets.size > 0 ? (
                  <button
                    type="button"
                    className="catalog-filters__popover-clear"
                    onClick={clearMarkets}
                  >
                    {t("all")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="catalog-filters__field">
          <label>{t("category")}</label>
          <div className="catalog-filters__multi" ref={categoryRef}>
            <button
              type="button"
              className="catalog-filters__multi-trigger"
              onClick={() => setCategoryOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={categoryOpen}
            >
              <span>{categoryLabel}</span>
              <span aria-hidden="true" className="catalog-filters__chev">
                ⌄
              </span>
            </button>
            {categoryOpen ? (
              <div className="catalog-filters__popover" role="dialog">
                {categories.map((c) => (
                  <label key={c.value} className="catalog-filters__popover-row">
                    <input
                      type="checkbox"
                      checked={selectedCategories.has(c.value)}
                      onChange={() => toggleCategory(c.value)}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
                {selectedCategories.size > 0 ? (
                  <button
                    type="button"
                    className="catalog-filters__popover-clear"
                    onClick={clearCategories}
                  >
                    {t("all")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="catalog-filters__field">
          <label>{t("type")}</label>
          <div className="catalog-filters__multi" ref={formatRef}>
            <button
              type="button"
              className="catalog-filters__multi-trigger"
              onClick={() => setFormatOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={formatOpen}
            >
              <span>{formatLabel}</span>
              <span aria-hidden="true" className="catalog-filters__chev">
                ⌄
              </span>
            </button>
            {formatOpen ? (
              <div className="catalog-filters__popover" role="dialog">
                {formats.map((f) => (
                  <label key={f.value} className="catalog-filters__popover-row">
                    <input
                      type="checkbox"
                      checked={selectedTypes.has(f.value)}
                      onChange={() => toggleFormat(f.value)}
                    />
                    <span>{f.label}</span>
                  </label>
                ))}
                {selectedTypes.size > 0 ? (
                  <button
                    type="button"
                    className="catalog-filters__popover-clear"
                    onClick={clearFormats}
                  >
                    {t("all")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="catalog-filters__field">
          <label htmlFor="nativeFit">{t("nativeFit")}</label>
          <select
            id="nativeFit"
            value={initial.nativeFit}
            onChange={(e) => setSingle("nativeFit", e.target.value)}
          >
            <option value="">{t("all")}</option>
            {nativeFits.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <div className="catalog-filters__field">
          <label htmlFor="b2bB2c">{t("b2bB2c")}</label>
          <select
            id="b2bB2c"
            value={initial.b2bB2c}
            onChange={(e) => setSingle("b2bB2c", e.target.value)}
          >
            <option value="">{t("all")}</option>
            {b2bB2cs.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={initial.onlyPriced}
            onChange={(e) => toggleOnlyPriced(e.target.checked)}
          />
          <span>{t("onlyPriced")}</span>
        </label>

        <button
          type="button"
          className="catalog-filters__advanced-toggle"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
        >
          {t("advanced")}{" "}
          <span aria-hidden="true">{advancedOpen ? "▴" : "▾"}</span>
        </button>
      </div>

      {advancedOpen ? (
        <div className="catalog-filters__advanced">
          <label className="filter-checkbox catalog-filters__compare-toggle">
            <input
              type="checkbox"
              checked={initial.compareMode}
              onChange={(e) => toggleCompareMode(e.target.checked)}
            />
            <span>
              {t("compareMode")}
              <small className="muted">{t("compareModeHint")}</small>
            </span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
