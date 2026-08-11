"use client";

import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { List, LayoutGrid } from "lucide-react";
import type { Density } from "./CatalogResults";

// Sits beside CatalogSort in the result bar: reorders vs. reshapes are both
// "how the list is presented" controls, not filters, so neither belongs in
// the rail.
export function CatalogDensityToggle({ initial }: { initial: Density }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const t = useTranslations("catalog.filters");
  const [isPending, startTransition] = useTransition();

  function set(value: Density) {
    const next = new URLSearchParams(sp.toString());
    if (value === "cards") next.set("density", "cards");
    else next.delete("density");
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="catalog-density-toggle" role="group" aria-label={t("densityLabel")}>
      <button
        type="button"
        className={`catalog-density-toggle__btn${initial === "list" ? " is-active" : ""}`}
        aria-pressed={initial === "list"}
        disabled={isPending}
        onClick={() => set("list")}
      >
        <List size={16} strokeWidth={1.7} aria-hidden="true" />
        {t("densityList")}
      </button>
      <button
        type="button"
        className={`catalog-density-toggle__btn${initial === "cards" ? " is-active" : ""}`}
        aria-pressed={initial === "cards"}
        disabled={isPending}
        onClick={() => set("cards")}
      >
        <LayoutGrid size={16} strokeWidth={1.7} aria-hidden="true" />
        {t("densityCards")}
      </button>
    </div>
  );
}
