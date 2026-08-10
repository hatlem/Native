// Catalog-search synonym layer: maps a buyer's vocabulary across
// en/no/sv/da/de/fi (and common ASCII-typo variants of Norwegian/Swedish
// diacritics) onto every other term that means the same thing, so a query
// for "lastebil" also matches titles indexed under "transport" or "truck".
//
// Every term is PRE-NORMALIZED to exactly match what
// src/lib/catalog-search.ts does to a raw query word before building a
// tsquery: lowercase, then strip everything that isn't a Unicode letter or
// digit. æ/ø/å/ä/ö are Unicode letters, so they survive that strip — do NOT
// store ASCII-folded forms as if they were the "normalized" form; store
// both the diacritic and the common ASCII-typo spelling as separate group
// members instead (e.g. "sjømat" AND "sjomat").
//
// Keep this module data-only (no DB, no Prisma) so it can be imported by
// both catalog-search.ts and, later, other consumers (e.g. brief-match.ts)
// without pulling in unrelated dependencies.

const NORMALIZE_RE = /[^\p{Letter}\p{Number}]/gu;

/** Same normalization catalog-search.ts applies to each query word. */
export function normalizeSynonymTerm(raw: string): string {
  return raw.toLowerCase().replace(NORMALIZE_RE, "");
}

// prettier-ignore
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // Transport & logistics / fleet — the ABAX segment.
  [
    "lastebil", "lastbil", "lastvogn", "lkw", "truck", "trucks", "trucking",
    "transport", "logistikk", "logistik", "logistics", "godstransport",
    "varebil", "yrkesbil", "yrkestrafikk", "vognpark", "flåte", "flate",
    "fleet", "buss", "bus", "spedisjon", "kuljetus",
  ],
  // Construction & heavy machinery.
  [
    "anlegg", "anleggsmaskin", "entreprenad", "entreprenør", "entreprenor",
    "bygg", "byggeri", "construction", "maskin", "maskiner", "gravemaskin",
    "bau", "baumaschinen", "rakennus",
  ],
  // Aquaculture / seafood / maritime.
  [
    "havbruk", "akvakultur", "aquaculture", "oppdrett", "oppdrettslaks",
    "laks", "lax", "salmon", "fiskeri", "fiske", "fisk", "fisheries",
    "fishing", "seafood", "sjømat", "sjomat", "maritim", "maritime",
  ],
  // Agriculture & farming.
  [
    "landbruk", "lantbruk", "landbrug", "jordbruk", "agriculture", "farming",
    "bonde", "gartner", "gartneri", "trädgård", "tradgard", "hage",
    "landwirtschaft", "maatalous",
  ],
  // Events & live entertainment.
  [
    "event", "events", "arrangement", "evenemang", "konsert", "concert",
    "konzert", "arena", "festival", "scene", "live",
  ],
];

let index: Map<string, readonly string[]> | null = null;

function buildIndex(): Map<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      map.set(term, group);
    }
  }
  return map;
}

/**
 * Every synonym for `term`, including `term` itself. Unknown terms return
 * a single-element array containing just the (normalized) term.
 */
export function expandTerm(term: string): string[] {
  if (!index) index = buildIndex();
  const normalized = normalizeSynonymTerm(term);
  const group = index.get(normalized);
  if (group) return [...group];
  return [normalized];
}
