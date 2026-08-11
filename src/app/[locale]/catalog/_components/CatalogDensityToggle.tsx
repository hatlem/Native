"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { List, LayoutGrid } from "lucide-react";
import type { Density } from "./CatalogResults";

// Sits beside CatalogSort in the result bar: reorders vs. reshapes are both
// "how the list is presented" controls, not filters, so neither belongs in
// the rail. Full navigation, not router.replace() — see CatalogSort.tsx for
// why: same-route RSC soft navigation is currently broken in production.
export function CatalogDensityToggle({ initial }: { initial: Density }) {
  const sp = useSearchParams();
  const t = useTranslations("catalog.filters");

  function set(value: Density) {
    const next = new URLSearchParams(sp.toString());
    if (value === "cards") next.set("density", "cards");
    else next.delete("density");
    window.location.href = `${window.location.pathname}?${next.toString()}`;
  }

  return (
    <div className="catalog-density-toggle" role="group" aria-label={t("densityLabel")}>
      <button
        type="button"
        className={`catalog-density-toggle__btn${initial === "list" ? " is-active" : ""}`}
        aria-pressed={initial === "list"}
        onClick={() => set("list")}
      >
        <List size={16} strokeWidth={1.7} aria-hidden="true" />
        {t("densityList")}
      </button>
      <button
        type="button"
        className={`catalog-density-toggle__btn${initial === "cards" ? " is-active" : ""}`}
        aria-pressed={initial === "cards"}
        onClick={() => set("cards")}
      >
        <LayoutGrid size={16} strokeWidth={1.7} aria-hidden="true" />
        {t("densityCards")}
      </button>
    </div>
  );
}
