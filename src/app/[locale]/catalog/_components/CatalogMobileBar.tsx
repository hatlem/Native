"use client";

import { useState, type ComponentProps } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SlidersHorizontal, X } from "lucide-react";
import { CatalogRail } from "./CatalogRail";

const SEARCH_DEBOUNCE_MS = 300;

type Option = { value: string; label: string };
type RailInitial = ComponentProps<typeof CatalogRail>["initial"];

// Filter params the "Filters N" count covers (search has its own box).
const COUNTED_LISTS = ["market", "types", "vertical", "region"] as const;
const COUNTED_FLAGS = [
  "nativeFit",
  "b2bB2c",
  "onlyPriced",
  "producedForYou",
  "guaranteedReach",
  "newsletterIncluded",
  "videoIncluded",
  "compareMode",
] as const;

function filterCount(p: URLSearchParams): number {
  const listCount = COUNTED_LISTS.reduce(
    (n, key) => n + (p.get(key) ?? (key === "types" ? p.get("type") : null) ?? "").split(",").filter(Boolean).length,
    0,
  );
  return listCount + COUNTED_FLAGS.filter((key) => !!p.get(key)).length;
}

// Mobile-only (<640px) sticky top bar per the 2c spec: a search box always
// visible, plus a "Filters N" chip that opens the full CatalogRail as a
// full-screen sheet instead of the desktop's always-visible 268px column.
// Desktop keeps rendering CatalogRail directly in page.tsx — this
// component (and its sheet) is CSS-hidden above 640px.
//
// The sheet's rail is STAGED: taps build a draft and "Apply (n)" navigates
// once with all of them. It used to navigate (and close the sheet) on every
// tap, so picking two markets took two open-tap-reload cycles.
export function CatalogMobileBar({
  markets,
  formats,
  nativeFits,
  b2bB2cs,
  reaches,
  categories,
  regions,
  unpricedCount,
  initial,
}: {
  markets: Option[];
  formats: Option[];
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
  // The sheet's draft query; null until the buyer changes something. The
  // rail inside is remounted on every open (key), so a closed-without-apply
  // sheet starts from the page's real filters next time.
  const [draft, setDraft] = useState<URLSearchParams | null>(null);
  const [sheetKey, setSheetKey] = useState(0);

  const activeCount = filterCount(new URLSearchParams(sp.toString()));
  const draftCount = draft ? filterCount(draft) : activeCount;

  function openSheet() {
    setDraft(null);
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  }

  function apply() {
    if (!draft) {
      setSheetOpen(false);
      return;
    }
    const next = new URLSearchParams(draft.toString());
    next.delete("page");
    // Full navigation (see CatalogSort.tsx): same-route soft navigation is
    // broken in production.
    window.location.href = `${window.location.pathname}?${next.toString()}`;
  }

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
          onClick={openSheet}
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
            key={sheetKey}
            staged
            onDraftChange={setDraft}
            markets={markets}
            formats={formats}
            nativeFits={nativeFits}
            b2bB2cs={b2bB2cs}
            reaches={reaches}
            categories={categories}
            regions={regions}
            unpricedCount={unpricedCount}
            initial={initial}
          />
        </div>
        <button type="button" className="catalog-rail-sheet__apply btn block" onClick={apply}>
          {tf("apply")} {draftCount > 0 ? `(${draftCount})` : ""}
        </button>
      </div>
    </>
  );
}
