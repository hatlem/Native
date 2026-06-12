import type { ProductInclusions } from "./inclusions";

// Generated, per-locale product display names. Product.name is raw
// publisher-offer text in whatever language the offer arrived in
// ("Native 1 sak (80k visn/mnd)") — desk-internal only. Buyers see a
// clean name built from the localized type label plus the single most
// salient inclusion fact, rendered through titleDetail.nameQ templates.

export type DisplayNameArgs = {
  // Already-localized product type label ("Native-artikkel").
  typeLabel: string;
  inclusions: ProductInclusions | null;
  // Locale-aware Intl formatter — callers own the locale.
  formatNumber: (n: number) => string;
  // titleDetail-namespaced translator; server components own getTranslations.
  t: (key: string, values?: Record<string, string | number>) => string;
};

type QualifierArgs = Omit<DisplayNameArgs, "typeLabel">;

// Multi-article offers are the clearest differentiator between sibling
// products of the same type, so they outrank every volume metric.
function articlesQualifier({ inclusions, t }: QualifierArgs): string | null {
  if (!inclusions?.articles || inclusions.articles <= 1) return null;
  return t("nameQ.articles", { count: inclusions.articles });
}

// Volume/duration facts in salience order. Print only qualifies when no
// other fact exists — it's a channel, not a size.
function metricQualifier({
  inclusions: inc,
  formatNumber,
  t,
}: QualifierArgs): string | null {
  if (!inc) return null;
  if (inc.viewsPerWeek)
    return t("nameQ.viewsPerWeek", { amount: formatNumber(inc.viewsPerWeek) });
  if (inc.viewsPerMonth)
    return t("nameQ.viewsPerMonth", { amount: formatNumber(inc.viewsPerMonth) });
  if (inc.viewsTotal)
    return t("nameQ.viewsTotal", { amount: formatNumber(inc.viewsTotal) });
  if (inc.readsTotal)
    return t("nameQ.readsTotal", { amount: formatNumber(inc.readsTotal) });
  if (inc.durationWeeks)
    return t("nameQ.durationWeeks", { weeks: inc.durationWeeks });
  if (inc.print) return t("nameQ.print");
  return null;
}

export function productDisplayName(args: DisplayNameArgs): string {
  const qualifier = articlesQualifier(args) ?? metricQualifier(args);
  return qualifier ? `${args.typeLabel} — ${qualifier}` : args.typeLabel;
}

// Index-aligned names for one title's card list. When two products would
// render identically (Akersposten: 1/2/3 saker, all "80k visn/mnd"), the
// colliding ones get the articles count appended as a second qualifier —
// the only second qualifier we allow, and only when needed for uniqueness.
// If that can't separate them, identical names are acceptable.
export function productDisplayNames(
  items: ReadonlyArray<Pick<DisplayNameArgs, "typeLabel" | "inclusions">>,
  formatNumber: DisplayNameArgs["formatNumber"],
  t: DisplayNameArgs["t"],
): string[] {
  const names = items.map((item) =>
    productDisplayName({ ...item, formatNumber, t }),
  );
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return names.map((name, i) => {
    if ((counts.get(name) ?? 1) < 2) return name;
    const inc = items[i].inclusions;
    // articles > 1 already led the name (priority 1) — nothing left to
    // append; without an articles count there is no disambiguator at all.
    if (!inc?.articles || inc.articles > 1) return name;
    const articlesQ = t("nameQ.articles", { count: inc.articles });
    const metricQ = metricQualifier({ inclusions: inc, formatNumber, t });
    const qualifier = metricQ ? `${metricQ} · ${articlesQ}` : articlesQ;
    return `${items[i].typeLabel} — ${qualifier}`;
  });
}
