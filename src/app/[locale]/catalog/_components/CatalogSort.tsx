"use client";

import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

// Sort is deliberately its own small component, separate from
// CatalogFilters: it reorders results rather than narrowing them, so it
// doesn't belong in the filter bar or as a removable filter chip — same
// distinction most catalog/marketplace UIs draw between "filter" and "sort".
export function CatalogSort({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const t = useTranslations("catalog.filters");
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set("sort", value);
    else next.delete("sort");
    next.delete("page");
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="catalog-sort">
      <label htmlFor="catalog-sort">{t("sortLabel")}</label>
      <select
        id="catalog-sort"
        value={initial}
        onChange={(e) => onChange(e.target.value)}
        disabled={isPending}
        aria-busy={isPending}
      >
        <option value="">{t("sortDefault")}</option>
        <option value="reach">{t("sortReach")}</option>
        <option value="newest">{t("sortNewest")}</option>
      </select>
    </div>
  );
}
