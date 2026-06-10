import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { FreshnessBucket } from "@/lib/pricing/freshness";
import { FRESHNESS_VALUES } from "../filters";

type Props = {
  locale: string;
  freshnessFilter: FreshnessBucket | undefined;
  /** Builds the query string for a given freshness bucket (undefined = clear). */
  freshnessQuery: (bucket: FreshnessBucket | undefined) => string;
};

// Price freshness filter chips
export async function FreshnessChips({ locale, freshnessFilter, freshnessQuery }: Props) {
  const t = await getTranslations({ locale, namespace: "deskTitles" });

  return (
    <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Link
        href={`/desk/titles${freshnessQuery(undefined)}`}
        className={`tag${!freshnessFilter ? " active" : ""}`}
        style={!freshnessFilter ? { fontWeight: 700, opacity: 1 } : { opacity: 0.65 }}
      >
        {t("freshness.filterAll")}
      </Link>
      {FRESHNESS_VALUES.map((bucket) => (
        <Link
          key={bucket}
          href={`/desk/titles${freshnessFilter === bucket ? freshnessQuery(undefined) : freshnessQuery(bucket)}`}
          className={`tag${freshnessFilter === bucket ? " active" : ""}`}
          style={freshnessFilter === bucket ? { fontWeight: 700, opacity: 1 } : { opacity: 0.65 }}
        >
          {t(`freshness.filter${bucket.charAt(0).toUpperCase()}${bucket.slice(1)}` as `freshness.filterNever` | `freshness.filterStale` | `freshness.filterAging` | `freshness.filterFresh`)}
        </Link>
      ))}
    </div>
  );
}
