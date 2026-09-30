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
    "fleet", "buss", "bus", "spedisjon", "kuljetus", "tungtransport",
    "tungt", "vogntog", "trailer", "semitrailer",
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
  // Electricians & electrical installers (a core ABAX trade).
  [
    "elektriker", "elektrikar", "elektrikare", "elektro", "elinstallasjon",
    "elektroinstallatør", "elektroinstallator", "installatør", "installator",
    "elinstallatör", "elinstallator", "electrician", "electrical",
    "sähköasentaja", "sahkoasentaja",
  ],
  // Plumbing, HVAC & heating.
  [
    "rørlegger", "rorlegger", "rørentreprenør", "rorentreprenor", "rørfag",
    "vvs", "rörmokare", "rormokare", "plumber", "plumbing", "ventilasjon",
    "ventilation", "varmepumpe", "kulde", "lvi",
  ],
  // Painters & decorators.
  [
    "maler", "malermester", "malerfag", "målare", "malare", "painter",
    "painting", "maalari",
  ],
  // Carpenters & general trades.
  [
    "håndverker", "handverker", "håndverk", "handverk", "tømrer", "tomrer",
    "snekker", "byggmester", "hantverkare", "hantverk", "håndværker",
    "handvaerker", "craftsman", "tradesman", "handwerker",
  ],
  // Forestry & wood industry.
  [
    "skog", "skogbruk", "skogsbruk", "skovbrug", "forestry", "tømmer",
    "tommer", "sagbruk", "treindustri", "metsä", "metsa", "forst",
  ],
  // Waste, recycling & renovation fleets.
  [
    "avfall", "renovasjon", "gjenvinning", "återvinning", "atervinning",
    "genbrug", "affald", "recycling", "waste", "kierrätys", "kierratys",
  ],
  // Municipalities & public sector operations.
  [
    "kommune", "kommunal", "kommunar", "kommun", "municipality", "municipal",
    "kunta", "gemeinde",
  ],
  // Events & live entertainment.
  [
    "event", "events", "arrangement", "evenemang", "konsert", "concert",
    "konzert", "arena", "festival", "scene", "live",
  ],
];

// ---------- spelling variants (æ/ø/å typed as ASCII, and back) ----------

// A buyer on a keyboard without æ/ø/å types "tromso", "baerum", "orsta"; the
// index holds "tromsø", "bærum", "ørsta" (the 'simple' FTS config doesn't
// fold diacritics). spellingVariants() produces the æ/ø/å spellings of an
// ASCII query word, so both the FTS query and the ILIKE fallback look for
// them. Only in that direction: a buyer who types "Sør" means Sør, and
// folding it to "sor" would pull in every "Sor…" title.

// ASCII spellings of æ/ø/å/ä/ö/ü: digraphs first (they are unambiguous),
// then single letters.
const DIGRAPHS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["ae", ["æ", "ä"]],
  ["oe", ["ø", "ö"]],
  ["aa", ["å"]],
  ["ue", ["ü"]],
];
const SINGLES: Readonly<Record<string, readonly string[]>> = {
  o: ["ø", "ö"],
  a: ["å", "ä"],
  u: ["ü"],
};
const MAX_SPELLING_VARIANTS = 10;

/**
 * The æ/ø/å spellings of an ASCII query word, never including the word
 * itself: the forms with ONE letter or digraph restored (each position on
 * its own, which covers real place and trade names: tromso → tromsø,
 * baerum → bærum, orsta → ørsta, malmo → malmö), capped so a long word can't
 * blow up the query. A word that already has such letters, and two-letter
 * words ("at" is not "åt"), have none.
 */
export function spellingVariants(word: string): string[] {
  const w = normalizeSynonymTerm(word);
  if (w.length < 3 || /[æøåäöü]/.test(w)) return [];
  const out = new Set<string>();
  for (const [ascii, letters] of DIGRAPHS) {
    for (let i = w.indexOf(ascii); i >= 0; i = w.indexOf(ascii, i + 1)) {
      for (const l of letters) out.add(w.slice(0, i) + l + w.slice(i + ascii.length));
    }
  }
  for (let i = 0; i < w.length; i++) {
    for (const l of SINGLES[w[i]] ?? []) out.add(w.slice(0, i) + l + w.slice(i + 1));
  }
  return [...out].slice(0, MAX_SPELLING_VARIANTS);
}

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
  // The searched word always comes first: callers cap the variant list
  // (catalog-search.ts MAX_SYNONYMS_PER_WORD), and a long group must never
  // cut the buyer's own word out of their own query.
  if (group) return [normalized, ...group.filter((t) => t !== normalized)];
  return [normalized];
}
