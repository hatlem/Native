import { getTranslations } from "next-intl/server";

export type ActiveFilter = { key: string; label: string; href: string };

// Plain <a>, not next-intl's <Link> — see CatalogPagination.tsx: same-route
// RSC soft navigation is currently broken in production on this page.
export async function ActiveFilterChips({
  locale,
  filters,
}: {
  locale: string;
  filters: ActiveFilter[];
}) {
  if (filters.length === 0) return null;
  const t = await getTranslations({ locale, namespace: "catalog" });

  return (
    <div className="filter-chips" style={{ marginTop: 12 }}>
      {filters.map((f) => (
        <a key={f.key} href={`/${locale}${f.href}`} className="filter-chip">
          {f.label}
          <span className="x" aria-label={t("removeFilter")}>
            ×
          </span>
        </a>
      ))}
      {filters.length >= 2 ? (
        <a href={`/${locale}/catalog`} className="filter-chip">
          {t("clearFilters")}
        </a>
      ) : null}
    </div>
  );
}
