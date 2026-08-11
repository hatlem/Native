"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

// Sort is deliberately its own small component, separate from
// CatalogFilters: it reorders results rather than narrowing them, so it
// doesn't belong in the filter bar or as a removable filter chip — same
// distinction most catalog/marketplace UIs draw between "filter" and "sort".
//
// Full navigation, not router.replace(): Next.js's client-side (RSC) soft
// navigation is currently broken in production for same-route searchParams
// changes on this page — every soft nav attempt (router.replace/push, and
// even plain <Link> clicks) fails server-side with "The router state header
// was sent but could not be parsed" (a known class of Next.js issue with
// same-route soft navigation on force-dynamic pages). A full navigation
// hits the same code path a bookmark or reload does, which works. Revisit
// once the underlying Next.js issue is resolved.
export function CatalogSort({ initial }: { initial: string }) {
  const sp = useSearchParams();
  const t = useTranslations("catalog.filters");

  function onChange(value: string) {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set("sort", value);
    else next.delete("sort");
    next.delete("page");
    window.location.href = `${window.location.pathname}?${next.toString()}`;
  }

  return (
    <div className="catalog-sort">
      <label htmlFor="catalog-sort">{t("sortLabel")}</label>
      <select id="catalog-sort" value={initial} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("sortDefault")}</option>
        <option value="reach">{t("sortReach")}</option>
        <option value="newest">{t("sortNewest")}</option>
      </select>
    </div>
  );
}
