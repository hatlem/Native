// How well a title's name answers what someone typed, for a name search
// whose matches otherwise come back in catalog order (market, publisher,
// name). The desk searching "Aftenposten" wants the title called exactly
// that, not A-magasinet and seven Aftenposten supplements first
// (BUG-final-verify-3):
//
//   0  exact     the name is the query              "Aftenposten"
//   1  prefix    the name starts with it            "Aftenposten Helg"
//   2  the rest  any other match (inside the name, the publisher, a tag)
//
// Case, repeated spaces and Unicode composition don't count as differences.
// Pure and DB-free; the buyer catalog ranks its own way (catalog-search.ts).

export type NameMatchRank = 0 | 1 | 2;

function normalized(s: string): string {
  return s.normalize("NFC").toLocaleLowerCase("nb").replace(/\s+/g, " ").trim();
}

export function nameMatchRank(name: string, query: string): NameMatchRank {
  const q = normalized(query);
  if (!q) return 2;
  const n = normalized(name);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  return 2;
}

/** `items` best name match first. Stable: within a rank the caller's order
 *  (the catalog order the query came back in) is kept. */
export function rankByNameMatch<T extends { name: string }>(items: readonly T[], query: string): T[] {
  return items
    .map((item, index) => ({ item, index, rank: nameMatchRank(item.name, query) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((r) => r.item);
}
