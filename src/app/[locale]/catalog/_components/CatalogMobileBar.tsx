"use client";

import { useState, type ComponentProps } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SlidersHorizontal, X } from "lucide-react";
import { CatalogRail } from "./CatalogRail";

const SEARCH_DEBOUNCE_MS = 300;

type Option = { value: string; label: string };
type RailInitial = ComponentProps<typeof CatalogRail>["initial"];

// Mobile-only (<640px) sticky top bar per the 2c spec: a search box always
// visible, plus a "Filters N" chip that opens the full CatalogRail as a
// full-screen sheet instead of the desktop's always-visible 268px column.
// Desktop keeps rendering CatalogRail directly in page.tsx — this
// component (and its sheet) is CSS-hidden above 640px.
export function CatalogMobileBar({
  markets,
  nativeFits,
  b2bB2cs,
  reaches,
  categories,
  regions,
  unpricedCount,
  initial,
}: {
  markets: Option[];
  nativeFits: Option[];
  b2bB2cs: Option[];
  reaches: Option[];
  categories: Option[];
  regions: Option[];
  unpricedCount: number | null;
  initial: RailInitial;
}) {
  const t = useTranslations("catalog.rail");
  const tf = useTranslations("catalog.filters");
  const sp = useSearchParams();
  const [q, setQ] = useState(initial.q);
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeCount =
    initial.markets.length +
    initial.verticals.length +
    initial.regions.length +
    (initial.nativeFit ? 1 : 0) +
    (initial.b2bB2c ? 1 : 0) +
    (initial.onlyPriced ? 1 : 0) +
    (initial.producedForYou ? 1 : 0) +
    (initial.guaranteedReach ? 1 : 0) +
    (initial.newsletterIncluded ? 1 : 0) +
    (initial.videoIncluded ? 1 : 0) +
    (initial.compareMode ? 1 : 0);

  function commitSearch(value: string) {
    setQ(value);
    window.clearTimeout((commitSearch as { _t?: number })._t);
    (commitSearch as { _t?: number })._t = window.setTimeout(() => {
      const next = new URLSearchParams(sp.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      next.delete("page");
      window.location.href = `${window.location.pathname}?${next.toString()}`;
    }, SEARCH_DEBOUNCE_MS);
  }

  return (
    <>
      <div className="catalog-mobile-bar">
        <input
          type="search"
          className="catalog-mobile-bar__search"
          value={q}
          onChange={(e) => commitSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={tf("search")}
          autoComplete="off"
        />
        <button
          type="button"
          className="catalog-mobile-bar__filters-btn"
          onClick={() => setSheetOpen(true)}
        >
          <SlidersHorizontal size={15} strokeWidth={1.7} aria-hidden="true" />
          {t("mobileFilters")}
          {activeCount > 0 ? <span className="catalog-mobile-bar__count">{activeCount}</span> : null}
        </button>
      </div>

      <div className={`catalog-rail-sheet${sheetOpen ? " is-open" : ""}`} aria-label={t("heading")}>
        {/* CatalogRail renders its own "Narrow it down" eyebrow + Reset
            row — this header only adds the close control the rail itself
            has no reason to know about. */}
        <div className="catalog-rail-sheet__head">
          <button
            type="button"
            className="catalog-rail-sheet__close"
            onClick={() => setSheetOpen(false)}
            aria-label={tf("apply")}
          >
            <X size={18} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
        <div className="catalog-rail-sheet__body">
          <CatalogRail
            markets={markets}
            nativeFits={nativeFits}
            b2bB2cs={b2bB2cs}
            reaches={reaches}
            categories={categories}
            regions={regions}
            unpricedCount={unpricedCount}
            initial={initial}
          />
        </div>
        <button
          type="button"
          className="catalog-rail-sheet__apply btn block"
          onClick={() => setSheetOpen(false)}
        >
          {tf("apply")} {activeCount > 0 ? `(${activeCount})` : ""}
        </button>
      </div>
    </>
  );
}
