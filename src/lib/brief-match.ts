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
function contains(haystack: string, term: string): boolean {
  return haystack.includes(term);
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
  keyword: 1,
  nativeFitHigh: 1,
};

export function scoreTitle(title: MatchableTitle, facets: BriefFacets): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const facetText = [title.vertical, title.audience, title.category, title.tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (facets.audienceType && title.b2bB2c && title.b2bB2c.toUpperCase() === facets.audienceType) {
    score += W.audience;
    reasons.push(facets.audienceType);
  }

  for (const ind of facets.industries) {
    const terms = INDUSTRY_TERMS[ind] ?? [ind];
    if (terms.some((t) => facetText.includes(t))) {
      score += W.industry;
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
    const hit = facets.locations.find((p) => loc.includes(p));
    if (hit) {
      score += W.location;
      reasons.push(hit);
    }
    // A place was named and this title is local/regional → small boost.
    if (title.reach && ["local", "regional"].includes(title.reach.toLowerCase())) {
      score += W.localBoost;
    }
  }

  for (const kw of facets.keywords) {
    if (facetText.includes(kw)) {
      score += W.keyword;
      if (!reasons.includes(kw)) reasons.push(kw);
    }
  }

  // nativeFit is a quality tiebreaker, not a match on its own — only nudge
  // titles that already matched something, so "High fit" can't make an
  // otherwise-irrelevant title appear as a brief match.
  if (score > 0 && title.nativeFit && title.nativeFit.toLowerCase() === "high") {
    score += W.nativeFitHigh;
  }

  return { score, reasons };
}

export type MatchOptions = { limit?: number; minScore?: number };

export function matchTitles(
  titles: MatchableTitle[],
  facets: BriefFacets,
  opts: MatchOptions = {},
): TitleMatch[] {
  const minScore = opts.minScore ?? 1;
  const scored = titles
    .map((title) => ({ title, ...scoreTitle(title, facets) }))
    .filter((m) => m.score >= minScore)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.title.digitalReach ?? b.title.monthlyReach ?? 0) -
          (a.title.digitalReach ?? a.title.monthlyReach ?? 0) ||
        a.title.name.localeCompare(b.title.name),
    );
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
