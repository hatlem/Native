import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export type ActiveFilter = { key: string; label: string; href: string };

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
        <Link key={f.key} href={f.href} className="filter-chip">
          {f.label}
          <span className="x" aria-label={t("removeFilter")}>
            ×
          </span>
        </Link>
      ))}
      {filters.length >= 2 ? (
        <Link href="/catalog" className="filter-chip">
          {t("clearFilters")}
        </Link>
      ) : null}
    </div>
  );
}
