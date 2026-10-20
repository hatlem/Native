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
  // Construction. Prefix matching already carries "bygg" to byggeri,
  // byggevare, byggenæring …, so only genuinely different words go here.
  [
    "bygg", "byggeri", "anlegg", "anleggsmaskin", "entreprenør", "entreprenor",
    "entreprenad", "construction", "contractor", "building", "bau", "bouw",
    "rakennus",
  ],
  // Machinery & equipment.
  [
    "maskin", "maskiner", "gravemaskin", "machinery", "baumaschinen",
    "koneet", "maskinpark",
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
  // Property & real estate.
  [
    "eiendom", "eiendomsmegler", "megler", "bolig", "boliger", "boligmarked",
    "fastighet", "fastigheter", "ejendom", "ejendomme", "property",
    "immobilien", "kiinteistö", "kiinteisto", "housing",
  ],
  // Interior, furniture & home.
  [
    "interiør", "interior", "innredning", "møbler", "mobler", "möbler",
    "møbel", "furniture", "kjøkken", "kjokken", "köök", "sisustus",
  ],
  // Architecture & design.
  [
    "arkitektur", "arkitekt", "architecture", "architect", "arkitektura",
    "arkkitehtuuri", "design",
  ],
  // Energy, power & oil/gas.
  [
    "energi", "energy", "energie", "energia", "kraft", "fornybar",
    "renewable", "solenergi", "vindkraft", "olje", "oil", "gass", "offshore",
  ],
  // Industry & manufacturing.
  [
    "industri", "industry", "industrie", "teollisuus", "produksjon",
    "produktion", "manufacturing", "verksted", "verkstad", "fabrikk",
  ],
  // Technology, IT & software.
  [
    "teknologi", "technology", "teknik", "tech", "data", "digital",
    "programvare", "software", "ikt", "informatik", "tietotekniikka",
  ],
  // Business & economy.
  [
    "økonomi", "okonomi", "ekonomi", "economy", "finans", "finance",
    "næringsliv", "naeringsliv", "näringsliv", "erhverv", "business",
    "wirtschaft", "talous", "børs", "bors",
  ],
  // Accounting.
  [
    "regnskap", "redovisning", "revisjon", "accounting", "bokføring",
    "bokforing", "bookkeeping",
  ],
  // Health & care.
  [
    "helse", "hälsa", "halsa", "sundhed", "health", "gesundheit", "terveys",
    "medisin", "medicine", "sykehus", "omsorg", "farmasi", "apotek",
  ],
  // Education & research.
  [
    "utdanning", "utbildning", "uddannelse", "education", "bildung",
    "koulutus", "skole", "school", "student", "forskning", "research",
    "universitet",
  ],
  // Cars & motoring.
  [
    "motor", "auto", "automotive", "biler", "bilar", "elbil", "kjøretøy",
    "kjoretoy", "fordon", "vehicle", "fahrzeug", "ajoneuvo", "motorsport",
  ],
  // Food & restaurants.
  [
    "restaurant", "restaurang", "ravintola", "servering", "gastronomi",
    "gastronomy", "kokk", "food", "matvarer",
  ],
  // Retail & commerce.
  [
    "handel", "detaljhandel", "retail", "butikk", "butik", "nettbutikk",
    "ehandel", "ecommerce", "dagligvare", "dagligvarer", "grocery",
    "einzelhandel",
  ],
  // Travel & tourism.
  [
    "reise", "reiseliv", "resor", "rejser", "travel", "turisme", "turism",
    "tourism", "tourismus", "matkailu", "ferie", "hotell", "hotel",
  ],
  // Sports & outdoors.
  [
    "sport", "idrett", "idrott", "idræt", "urheilu", "trening", "fitness",
    "friluftsliv", "friluft", "outdoor", "jakt", "hunting",
  ],
  // Careers & recruitment.
  [
    "karriere", "career", "rekruttering", "recruitment", "bemanning",
    "staffing", "jobb", "jobs", "stillinger", "arbeidsliv", "arbeidsmarked",
  ],
  // Law.
  ["juridisk", "juridik", "advokat", "lawyer", "legal"],
  // Families & children.
  [
    "barn", "familie", "foreldre", "children", "kids", "family", "parents",
    "kinder", "lapset", "perhe", "børn",
  ],
  // Women.
  ["kvinne", "kvinner", "dame", "women", "woman", "frauen", "naiset", "kvinder"],
  // Culture & arts.
  [
    "kultur", "culture", "kunst", "musikk", "music", "musik", "teater",
    "theatre", "film", "litteratur", "taide",
  ],
  // Local press.
  [
    "lokal", "local", "paikallis", "lokalzeitung", "hyperlokal", "distrikt",
  ],
  // Pets & horses.
  [
    "kjæledyr", "kjaeledyr", "kæledyr", "husdyr", "pets", "lemmikki", "hest",
    "horse",
  ],
  // Boating.
  [
    "båt", "båter", "båtliv", "batliv", "boat", "boating", "yacht", "segling",
    "sailing", "veneily",
  ],
  // Fashion, beauty & lifestyle.
  [
    "mote", "fashion", "skjønnhet", "skjonnhet", "beauty", "kosmetikk",
    "cosmetics", "livsstil", "lifestyle", "muoti",
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
