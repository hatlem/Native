// Brief-based title matching (deterministic core of the hybrid matcher).
//
// A buyer describes who they want to reach in free text; we extract facets
// from it via a curated, multilingual taxonomy (the 9 markets: en/no/sv/da/
// de/fi), then score each catalog title against those facets. Scoring (not
// hard AND/OR filtering) means a very specific brief still returns the best
// available titles, ranked, each with the reasons it matched — and market
// is the one hard filter, applied by the caller.
//
// Pure + DB-free so it is fully unit-tested. The optional LLM enrichment
// (brief-match-llm.ts) produces the same BriefFacets shape and is merged in
// before scoring.

import { expandTerm } from "@/lib/search-synonyms";

export type AudienceType = "B2B" | "B2C";
export type GeoScope = "National" | "Regional" | "Local" | "International";

export type BriefFacets = {
  audienceType: AudienceType | null;
  // Canonical industry keys (see INDUSTRY_TERMS), matched against a title's
  // vertical / audience / category text.
  industries: string[];
  geoScopes: GeoScope[];
  // Place names mentioned (cities/regions) — boost local/regional titles
  // and match against locationNote.
  locations: string[];
  // Residual meaningful words for a loose tags/audience/vertical match.
  keywords: string[];
};

export type MatchableTitle = {
  id: string;
  name: string;
  b2bB2c: string | null;
  vertical: string | null;
  audience: string | null;
  category: string | null;
  reach: string | null;
  nativeFit: string | null;
  tags: string | null;
  locationNote: string | null;
  digitalReach: number | null;
  monthlyReach: number | null;
  // Richer per-title fields (curated, not CSV-import lineage). A brief that
  // only overlaps with these — not the coarse vertical/audience/category —
  // should still be able to find and rank the title.
  description: string | null;
  keywords: string[];
  aliases: string[];
  audienceNote: string | null;
  city: string | null;
  region: string | null;
};

export type TitleMatch = {
  title: MatchableTitle;
  score: number;
  reasons: string[];
};

// ---------- Taxonomy ----------

const B2B_TERMS = [
  "b2b", "business", "businesses", "professional", "professionals", "trade",
  "industry", "industries", "enterprise", "corporate", "decision maker",
  "decision makers", "decision-maker", "decision-makers",
  "bedrift", "bedrifter", "næringsliv", // no
  "företag", "näringsliv", // sv
  "virksomhed", "virksomheder", "erhverv", // da
  "unternehmen", "geschäftskunden", "gewerbe", // de
  "yritys", "yritykset", "ammattilaiset", // fi
];

const B2C_TERMS = [
  "b2c", "consumer", "consumers", "public", "households", "shoppers",
  "forbruker", "forbrukere", "privatperson", // no
  "konsument", "konsumenter", // sv
  "forbruger", "forbrugere", // da
  "verbraucher", "konsument", // de
  "kuluttaja", "kuluttajat", // fi
];

// Canonical industry -> trigger terms (multilingual). Matched as substrings
// against a title's vertical/audience/category/tags text.
const INDUSTRY_TERMS: Record<string, string[]> = {
  finance: ["finance", "financial", "bank", "banking", "fintech", "insurance", "økonomi", "finans", "forsikring", "ekonomi", "versicherung", "rahoitus"],
  legal: ["legal", "law", "lawyer", "lawyers", "attorney", "juss", "jus", "advokat", "juridik", "recht", "anwalt", "laki", "juridik"],
  health: ["health", "healthcare", "medical", "pharma", "pharmaceutical", "nurse", "nurses", "doctor", "helse", "sykepleier", "lege", "sundhed", "gesundheit", "terveys", "hälsa"],
  fitness: ["fitness", "training", "workout", "gym", "trening", "träning", "træning", "kunto"],
  agriculture: ["agriculture", "farming", "farmer", "farmers", "landbruk", "gård", "lantbruk", "bonde", "landwirtschaft", "maatalous"],
  // Sourced from search-synonyms.ts's aquaculture/seafood/maritime group so
  // the two taxonomies never drift apart: a buyer who only says "aquaculture"
  // (English) still resolves to the same industry as one who says "havbruk"
  // or "sjømat", and both surface titles carrying the Norwegian keywords.
  //
  // "maritim"/"maritime" are filtered back out here: they're ambiguous
  // between transport (shipping/maritime logistics) and aquaculture (fish
  // farming), and `transport` above already owns them. Without this filter
  // a pure transport brief ("maritime logistics") would also surface
  // fish-farming trade press. Filtered at this call site — not in
  // search-synonyms.ts itself — because catalog-search.ts consumes the same
  // shared group and legitimately wants "maritime" to resolve to the
  // seafood/aquaculture titles when a buyer searches for it directly.
  aquaculture: expandTerm("aquaculture").filter(
    (t) => t !== "maritim" && t !== "maritime",
  ),
  tech: ["tech", "technology", "software", "saas", "it", "digital", "teknologi", "ohjelmisto"],
  marketing: ["marketing", "advertising", "media", "agency", "reklame", "markedsføring", "marknadsföring", "werbung", "markkinointi"],
  retail: ["retail", "ecommerce", "e-commerce", "shop", "handel", "varehandel", "detaljhandel", "einzelhandel", "vähittäiskauppa"],
  energy: ["energy", "oil", "gas", "power", "renewable", "energi", "olje", "kraft", "energie", "energia"],
  education: ["education", "teacher", "teachers", "school", "academic", "utdanning", "skole", "lærer", "utbildning", "bildung", "koulutus", "akademiker"],
  auto: ["auto", "automotive", "car", "cars", "motor", "vehicle", "bil", "fordon", "fahrzeug", "auto"],
  construction: ["construction", "property", "real estate", "building", "eiendom", "bygg", "fastighet", "immobilien", "rakennus"],
  sports: ["sport", "sports", "football", "soccer", "hockey", "running", "idrett", "fotball", "sport", "urheilu"],
  food: ["food", "drink", "restaurant", "culinary", "mat", "drikke", "ruoka", "essen", "lebensmittel"],
  politics: ["politics", "political", "government", "policy", "politikk", "politik", "politiikka"],
  charity: ["charity", "nonprofit", "third sector", "ngo", "veldedighet", "välgörenhet"],
  transport: [
    "transport", "logistics", "logistikk", "fleet", "flåte", "trucking",
    "lastebil", "truck", "trucks", "van", "vans", "varebil", "shipping",
    "maritime", "spedisjon", "kuljetus", "logistik",
  ],
  machinery: [
    "machinery", "machines", "anleggsmaskin", "maskin", "entreprenør",
    "equipment", "baumaschinen",
  ],
  trades: [
    "trades", "tradespeople", "håndverk", "håndverker", "elektriker",
    "rørlegger", "hantverkare", "handwerk", "craftsmen",
  ],
};

const GEO_SCOPE_TERMS: Record<GeoScope, string[]> = {
  National: ["national", "nationwide", "whole country", "across the country", "nasjonal", "hele landet", "rikstäckande", "landsdækkende", "bundesweit", "valtakunnallinen"],
  Regional: ["regional", "region", "county", "regionalt", "fylke", "län", "regional"],
  Local: ["local", "city", "town", "locally", "lokal", "lokalt", "by", "stad", "lokaalinen"],
  International: ["international", "global", "worldwide", "cross-border", "internasjonal", "global", "kansainvälinen"],
};

// Notable places across the markets. Presence implies a Local/Regional lean.
const PLACES = [
  "oslo", "bergen", "trondheim", "stavanger", "tromsø", "drammen",
  "stockholm", "gothenburg", "göteborg", "malmö", "uppsala",
  "copenhagen", "københavn", "aarhus", "odense",
  "helsinki", "tampere", "turku",
  "berlin", "munich", "münchen", "hamburg", "cologne", "köln", "frankfurt",
  "vienna", "wien", "zurich", "zürich", "geneva",
  "london", "manchester", "dublin",
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "our", "are", "who", "you", "your", "their",
  "that", "this", "they", "them", "from", "want", "need", "reach", "sell",
  "selling", "only", "also", "we", "us", "to", "in", "of", "a", "an", "is",
  "on", "at", "as", "or", "by", "be", "it", "i", "vi", "og", "som", "til",
  "er", "av", "en", "et", "för", "och", "att", "och",
]);

function normalize(text: string): string {
  return text.toLowerCase();
}

// Does the haystack contain the term as a word-ish substring?
//
// Short terms (<5 chars) are ambiguous as raw substrings — "it" (tech) hides
// inside "with", "car" (auto) hides inside "healthcare", "by" (Local) hides
// inside almost any English brief — so those are matched at word boundaries
// only. Terms >= 5 chars keep the looser substring match: it's deliberate
// that "health" (health) matches inside "healthcare".
const WORD_BOUNDARY_TERM_CACHE = new Map<string, RegExp>();

function wordBoundaryRegex(term: string): RegExp {
  let re = WORD_BOUNDARY_TERM_CACHE.get(term);
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
    WORD_BOUNDARY_TERM_CACHE.set(term, re);
  }
  return re;
}

function contains(haystack: string, term: string): boolean {
  if (term.length >= 5) return haystack.includes(term);
  return wordBoundaryRegex(term).test(haystack);
}

export function extractFacets(brief: string): BriefFacets {
  const text = normalize(brief);

  let audienceType: AudienceType | null = null;
  if (B2B_TERMS.some((t) => contains(text, t))) audienceType = "B2B";
  // B2C wins only if explicitly consumer-leaning AND not already B2B-flagged
  // by a stronger business signal; if both appear, leave null (ambiguous).
  if (B2C_TERMS.some((t) => contains(text, t))) {
    audienceType = audienceType === "B2B" ? null : "B2C";
  }

  const industries = Object.entries(INDUSTRY_TERMS)
    .filter(([, terms]) => terms.some((t) => contains(text, t)))
    .map(([key]) => key);

  const geoScopes = (Object.entries(GEO_SCOPE_TERMS) as [GeoScope, string[]][])
    .filter(([, terms]) => terms.some((t) => contains(text, t)))
    .map(([scope]) => scope);

  const locations = PLACES.filter((p) => contains(text, p));

  // Residual keywords: alphabetic tokens of length >= 3, minus stopwords and
  // anything already captured as an industry trigger.
  const captured = new Set([
    ...B2B_TERMS, ...B2C_TERMS,
    ...Object.values(INDUSTRY_TERMS).flat(),
    ...Object.values(GEO_SCOPE_TERMS).flat(),
    ...PLACES,
  ]);
  const keywords = Array.from(
    new Set(
      (text.match(/[\p{L}]{3,}/gu) ?? []).filter(
        (w) => !STOPWORDS.has(w) && !captured.has(w),
      ),
    ),
  );

  return { audienceType, industries, geoScopes, locations, keywords };
}

// Merge deterministic facets with LLM-derived ones (union; audienceType from
// LLM only fills a gap, never overrides a deterministic signal).
export function mergeFacets(base: BriefFacets, extra: Partial<BriefFacets>): BriefFacets {
  const uniq = (a: string[] = [], b: string[] = []) => Array.from(new Set([...a, ...b]));
  return {
    audienceType: base.audienceType ?? extra.audienceType ?? null,
    industries: uniq(base.industries, extra.industries),
    geoScopes: uniq(base.geoScopes, extra.geoScopes) as GeoScope[],
    locations: uniq(base.locations, extra.locations),
    keywords: uniq(base.keywords, extra.keywords),
  };
}

// ---------- Scoring ----------

const W = {
  audience: 5,
  industry: 4,
  geoScope: 2,
  location: 3,
  localBoost: 1,
  // A brief keyword found in the title's curated keywords[] array is a much
  // stronger signal than the same word merely appearing somewhere in the
  // loose facetText blob (e.g. buried in a tags string) — see `keyword`.
  structuredKeyword: 3,
  keyword: 1,
  nativeFitHigh: 1,
};

export function scoreTitle(
  title: MatchableTitle,
  facets: BriefFacets,
): { score: number; reasons: string[]; topicalScore: number } {
  let score = 0;
  // Sum of industry/keyword/location hits only — i.e. evidence the title is
  // actually ABOUT what the brief asked for, as opposed to just matching the
  // audience type or geography. Used by matchTitles to stop a broad B2B/geo
  // match from outranking topical relevance (see matchTitles).
  let topicalScore = 0;
  const reasons: string[] = [];

  const structuredKeywords = (title.keywords ?? []).map((k) => k.toLowerCase());
  const facetText = [
    title.vertical,
    title.audience,
    title.category,
    title.tags,
    title.description,
    title.audienceNote,
    title.city,
    title.region,
    structuredKeywords.join(" "),
    (title.aliases ?? []).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (facets.audienceType && title.b2bB2c && title.b2bB2c.toUpperCase() === facets.audienceType) {
    score += W.audience;
    reasons.push(facets.audienceType);
  }

  for (const ind of facets.industries) {
    const terms = INDUSTRY_TERMS[ind] ?? [ind];
    if (terms.some((t) => contains(facetText, t))) {
      score += W.industry;
      topicalScore += W.industry;
      reasons.push(ind);
    }
  }

  for (const scope of facets.geoScopes) {
    if (title.reach && title.reach.toLowerCase() === scope.toLowerCase()) {
      score += W.geoScope;
      reasons.push(scope);
    }
  }

  if (facets.locations.length && title.locationNote) {
    const loc = title.locationNote.toLowerCase();
    const hit = facets.locations.find((p) => contains(loc, p));
    if (hit) {
      score += W.location;
      topicalScore += W.location;
      reasons.push(hit);
    }
    // A place was named and this title is local/regional → small boost.
    if (title.reach && ["local", "regional"].includes(title.reach.toLowerCase())) {
      score += W.localBoost;
    }
  }

  for (const kw of facets.keywords) {
    const structuredHit = structuredKeywords.some((k) => contains(k, kw));
    if (structuredHit) {
      score += W.structuredKeyword;
      topicalScore += W.structuredKeyword;
      if (!reasons.includes(kw)) reasons.push(kw);
    } else if (contains(facetText, kw)) {
      score += W.keyword;
      topicalScore += W.keyword;
      if (!reasons.includes(kw)) reasons.push(kw);
    }
  }

  // nativeFit is a quality tiebreaker, not a match on its own — only nudge
  // titles that already matched something, so "High fit" can't make an
  // otherwise-irrelevant title appear as a brief match.
  if (score > 0 && title.nativeFit && title.nativeFit.toLowerCase() === "high") {
    score += W.nativeFitHigh;
  }

  return { score, reasons, topicalScore };
}

export type MatchOptions = { limit?: number; minScore?: number };

export function matchTitles(
  titles: MatchableTitle[],
  facets: BriefFacets,
  opts: MatchOptions = {},
): TitleMatch[] {
  const minScore = opts.minScore ?? 1;
  // When the brief names an industry/topic, audience/geo alone can't be
  // enough — a B2B title with zero topical evidence must not outrank (or
  // even appear ahead of) a title that actually matches the topic, no matter
  // how large its reach. A pure audience/geo brief ("B2B companies in
  // Norway") still matches on audience/geo alone, unchanged.
  const hasTopicalFacets = facets.industries.length > 0 || facets.keywords.length > 0;
  const scored = titles
    .map((title) => ({ title, ...scoreTitle(title, facets) }))
    .filter((m) => m.score >= minScore)
    .filter((m) => !hasTopicalFacets || m.topicalScore >= 1)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.title.digitalReach ?? b.title.monthlyReach ?? 0) -
          (a.title.digitalReach ?? a.title.monthlyReach ?? 0) ||
        a.title.name.localeCompare(b.title.name),
    )
    .map(({ topicalScore: _topicalScore, ...rest }) => rest);
  return opts.limit ? scored.slice(0, opts.limit) : scored;
}

// True when the brief produced no usable signal at all (caller can then fall
// back to the budget/reach recommender instead of showing nothing).
export function facetsAreEmpty(f: BriefFacets): boolean {
  return (
    !f.audienceType &&
    f.industries.length === 0 &&
    f.geoScopes.length === 0 &&
    f.locations.length === 0 &&
    f.keywords.length === 0
  );
}
