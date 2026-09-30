import { prisma } from "@/lib/prisma";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";
import { localizeVertical } from "@/lib/taxonomy-i18n";
import { safeLocale } from "@/i18n/routing";

// Distinct Title.vertical values across every title the catalog SHOWS —
// shared between the catalog's "Who reads it?" filter and the plan's
// targeting picker so both surfaces offer exactly the same, real vocabulary.
// Same visibility rule as the catalog itself (catalogVisibleTitleWhere):
// filtering on `active` alone offered 13 verticals and none of the B2B trade
// ones, although the catalog lists hundreds of those (unverified research)
// titles.
export async function loadVerticalOptions(): Promise<string[]> {
  const rows = await prisma.title.findMany({
    where: { ...catalogVisibleTitleWhere, vertical: { not: null } },
    select: { vertical: true },
    distinct: ["vertical"],
    orderBy: { vertical: "asc" },
  });
  return rows.map((r) => r.vertical!).filter((v) => v.trim().length > 0);
}

export type VerticalOption = { value: string; label: string };

/** The options with labels in the buyer's language, sorted by that label.
 *  The value stays the stored English taxonomy term (URLs, filters, the
 *  plan's targetVerticals). */
export function localizedVerticalOptions(values: readonly string[], locale: string): VerticalOption[] {
  const l = safeLocale(locale);
  const collator = new Intl.Collator(l === "no" ? "nb" : l, { sensitivity: "base" });
  return values
    .map((value) => ({ value, label: localizeVertical(value, l) }))
    .sort((a, b) => collator.compare(a.label, b.label));
}
