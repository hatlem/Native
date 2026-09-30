// Wraps Postgres FTS for the catalog: query against the `searchTsv`
// generated column (name + aliases weight A, category + keywords weight B,
// vertical weight B, audienceNote + description weight C, legacy tags
// weight C, website host weight B — see migrations
// 20260604170000_fts_keywords_description, 20260701020000_fts_vertical_tags
// and 20260924120000_fts_split_separators), fall back to plain ILIKE (extended
// with the same synonym expansion, plus keywords/aliases array lookups)
// when FTS finds nothing or the query can't build a tsquery at all.
//
// Every word of a query must match (FTS and ILIKE alike); only when no title
// matches ALL of them does the search widen to titles matching ANY of them,
// and it says so (resolveCatalogSearch). The old fallback OR-ed every word
// straight away, so "Asker og Bærum" listed 168 titles that merely contained
// "og". Filler words ("og", "and", "und" …) never have to match, and each
// word also matches its æ/ø/å spellings (search-synonyms.ts
// spellingVariants: "tromso" finds iTromsø).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { expandTerm, spellingVariants } from "@/lib/search-synonyms";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";

// Guard against pathological input blowing up the tsquery (a title with a
// huge synonym group, or a query with many words) — 15 synonyms per word is
// comfortably above our largest group. Spelling variants (at most 10, from
// search-synonyms.ts) come on top and never displace a synonym.
const MAX_SYNONYMS_PER_WORD = 15;

// Filler words across the UI languages. They never have to match: "Asker og
// Bærum" is about Asker and Bærum. A query of nothing but filler keeps them
// (someone may be looking for a title called "Og"). Deliberately not "it"
// ("B2B IT") nor anything that is also a real search term.
// prettier-ignore
const STOPWORDS = new Set([
  // no / da / sv
  "og", "och", "eller", "av", "af", "på", "til", "till", "for", "för", "med", "om", "fra", "från",
  "en", "et", "ett", "ei", "den", "det", "de", "som",
  // fi
  "ja", "tai", "sekä",
  // de
  "und", "oder", "der", "die", "das", "von", "mit", "für", "im", "am", "zu",
  // en
  "and", "or", "the", "of", "in", "on", "to", "an",
]);

/** The words of a query that must match: normalized, filler words dropped
 *  (unless that would leave nothing). */
export function significantWords(raw: string): string[] {
  const words = normalizeWords(raw);
  const kept = words.filter((w) => !STOPWORDS.has(w));
  return kept.length > 0 ? kept : words;
}

function normalizeWords(raw: string): string[] {
  // SPLIT on anything that isn't a letter/number — never delete separators
  // inside a word: "API-IT" must become [api, it] (matching Postgres's own
  // tokenization of the hyphenated lexeme), not the unsearchable "apiit";
  // "AT.no" must become [at, no], whose prefix queries match the 'at.no'
  // host lexeme. tsquery is strict about operators, so only bare
  // letter/number tokens survive.
  return raw
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((t) => t.length >= 2);
}

/**
 * Builds a `to_tsquery('simple', ...)`-ready string from a raw search
 * query: each word becomes `word:*` (prefix match), and words with known
 * synonyms expand into a parenthesized OR group, e.g. "lastebil" becomes
 * `(lastebil:* | lastbil:* | ... | transport:*)`. Multiple words are
 * AND-ed together so multi-word queries still narrow the result set.
 * Returns "" when the query has no matchable words.
 */
export function buildTsQuery(raw: string, match: "all" | "some" = "all"): string {
  const significant = new Set(significantWords(raw));
  const parts: string[] = [];
  for (const chunk of raw.split(/\s+/)) {
    // A domain ("vg.no", "t-online.de", a pasted URL) also matches the
    // title's website host, indexed whole as a host lexeme. The host's split
    // words stay as the alternative so "AT.no" still finds the name "AT.no";
    // a URL's scheme/www/path never become search words.
    const host = domainOf(chunk);
    const words = normalizeWords(host ?? chunk).filter((w) => host || significant.has(w));
    if (words.length === 0) continue;
    const group = words.map(wordTerm).join(" & ");
    parts.push(host ? `(${host}:* | ${words.length > 1 ? `(${group})` : group})` : group);
  }
  return parts.join(match === "all" ? " & " : " | ");
}

/**
 * Everything one query word may match: the word itself first (a long list is
 * capped and must never cut the buyer's own word), then its other spellings
 * (æ/ø/å), then synonyms of each.
 */
export function wordVariants(w: string): string[] {
  const spellings = spellingVariants(w);
  const all = new Set<string>([w, ...spellings, ...expandTerm(w).slice(0, MAX_SYNONYMS_PER_WORD)]);
  // A spelling that is itself a known term ("rørlegger") brings its group.
  for (const s of spellings) for (const syn of expandTerm(s).slice(0, MAX_SYNONYMS_PER_WORD)) all.add(syn);
  return [...all];
}

function wordTerm(w: string): string {
  const variants = wordVariants(w);
  if (variants.length <= 1) return `${w}:*`;
  return `(${variants.map((v) => `${v}:*`).join(" | ")})`;
}

// Labels of letters/digits joined by single inner hyphens, 2+ labels, and a
// letters-only TLD — the shape Postgres's parser reads as one host token.
// Only these characters can reach the tsquery, so no operator can leak in.
const DOMAIN_RE = /^(?:[\p{Letter}\p{Number}](?:[\p{Letter}\p{Number}-]*[\p{Letter}\p{Number}])?\.)+\p{Letter}{2,}$/u;

/** "https://www.VG.no/nyheter" → "vg.no"; null when the chunk isn't a domain. */
export function domainOf(chunk: string): string | null {
  const host = chunk
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#:]/)[0];
  return DOMAIN_RE.test(host) ? host : null;
}

// One word (with its variants) against the human-readable text fields and
// the publisher's name (the search box promises "title, publisher or topic",
// and the FTS index has no publisher column: "Asker og Bærum" is Budstikka's
// publisher, Asker og Bærums Budstikke ASA), plus array membership over the
// curated `keywords`/`aliases` columns.
function wordClause(variantList: string[], publisherVariants: string[] = variantList): Prisma.TitleWhereInput {
  const containsClauses: Prisma.TitleWhereInput[] = variantList.flatMap((v) => [
    { name: { contains: v, mode: "insensitive" as const } },
    { category: { contains: v, mode: "insensitive" as const } },
    { vertical: { contains: v, mode: "insensitive" as const } },
    { tags: { contains: v, mode: "insensitive" as const } },
    { city: { contains: v, mode: "insensitive" as const } },
  ]);
  return {
    OR: [
      ...containsClauses,
      ...publisherVariants.map((v) => ({ publisher: { name: { contains: v, mode: "insensitive" as const } } })),
      { keywords: { hasSome: variantList } },
      { aliases: { hasSome: variantList } },
    ],
  };
}

/**
 * Prisma fallback for when FTS returns zero rows (or the query can't produce
 * a tsquery at all): substring match per significant word, with its spelling
 * variants and synonyms. `all` (default) requires every word to match; `some`
 * any of them. A one-word query (or a phrase of only punctuation-free
 * non-words) is a single OR block either way.
 */
export function buildIlikeFallbackWhere(q: string, match: "all" | "some" = "all"): Prisma.TitleWhereInput {
  const trimmed = q.trim();
  if (!trimmed) return {};

  const words = significantWords(trimmed);
  // No letters/digits to split on: match the raw text as typed.
  // Publisher names match on the word and its spellings, never synonyms: a
  // substring match on a short synonym ("lvi") hits unrelated names
  // ("Svelviksposten").
  const spelled = (w: string) => [w, ...spellingVariants(w)];
  if (words.length === 0) return wordClause([trimmed]);
  if (words.length === 1) {
    return wordClause([trimmed, ...wordVariants(words[0])].filter(unique), [trimmed, ...spelled(words[0])]);
  }
  const clauses = words.map((w) => wordClause(wordVariants(w), spelled(w)));
  return match === "all" ? { AND: clauses } : { OR: clauses };
}

/** Titles whose publisher's name contains every significant word, as typed
 *  or in its æ/ø/å spelling. Not synonyms: a substring match on a short
 *  synonym ("lvi") would hit unrelated names ("Svelviksposten"). */
function publisherWhere(q: string): Prisma.TitleWhereInput {
  return {
    AND: significantWords(q).map((w) => ({
      OR: [w, ...spellingVariants(w)].map((v) => ({
        publisher: { name: { contains: v, mode: "insensitive" as const } },
      })),
    })),
  };
}

function unique<T>(v: T, i: number, arr: T[]): boolean {
  return arr.indexOf(v) === i;
}

/**
 * Combines an FTS result with the ILIKE fallback the way the catalog page
 * needs to: a non-empty FTS hit list wins outright; an empty-or-absent FTS
 * result falls through to the synonym-aware ILIKE fallback whenever there's
 * a query to search on; no query at all means no search filter.
 *
 * Isolated here (rather than inlined in the page) specifically so an empty
 * `matchedIds` array — a *valid* tsquery that matched nothing — doesn't get
 * treated as "search for nothing" (`id: { in: [] }`, always zero rows).
 */
export function searchWhereFor(
  q: string,
  matchedIds: string[] | null,
): Prisma.TitleWhereInput {
  if (matchedIds && matchedIds.length > 0) return { id: { in: matchedIds } };
  const trimmed = q.trim();
  if (trimmed) return buildIlikeFallbackWhere(trimmed);
  return {};
}

export async function searchTitleIds(query: string, match: "all" | "some" = "all"): Promise<string[] | null> {
  const q = query.trim();
  if (!q) return null;
  const tsq = buildTsQuery(q, match);
  if (!tsq) return null;
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "Title" WHERE "searchTsv" @@ to_tsquery('simple', ${tsq})`,
  );
  return rows.map((r) => r.id);
}

export type CatalogSearch = {
  where: Prisma.TitleWhereInput;
  // "all": titles matching every word. "some": nothing matched every word, so
  // these match at least one; the catalog says so above the results.
  match: "all" | "some";
};

/**
 * The catalog's search clause, tiered so titles matching EVERY word always
 * win and the search only widens when there are none:
 *   1. FTS, all words        2. ILIKE, all words
 *   3. FTS, any word         4. ILIKE, any word   (multi-word queries only)
 * Tiers are decided against the titles the catalog can show at all. Null for
 * an empty query.
 */
export async function resolveCatalogSearch(query: string): Promise<CatalogSearch | null> {
  const q = query.trim();
  if (!q) return null;
  const hits = async (where: Prisma.TitleWhereInput) =>
    (await prisma.title.count({ where: { AND: [catalogVisibleTitleWhere, where] }, take: 1 })) > 0;

  // FTS hits, plus every title of a publisher whose name has all the words
  // (the index doesn't cover publisher names; "Amedia" lists Amedia's titles).
  const allIds = await searchTitleIds(q, "all");
  if (allIds && allIds.length > 0) {
    const where: Prisma.TitleWhereInput = { OR: [{ id: { in: allIds } }, publisherWhere(q)] };
    if (await hits(where)) return { where, match: "all" };
  }
  const allWhere = buildIlikeFallbackWhere(q, "all");
  if (await hits(allWhere)) return { where: allWhere, match: "all" };

  if (significantWords(q).length > 1) {
    const someIds = await searchTitleIds(q, "some");
    if (someIds && someIds.length > 0) {
      const where = { id: { in: someIds } };
      if (await hits(where)) return { where, match: "some" };
    }
    const someWhere = buildIlikeFallbackWhere(q, "some");
    if (await hits(someWhere)) return { where: someWhere, match: "some" };
  }
  // Nothing anywhere: keep the strict clause (the page shows its no-match state).
  return { where: allWhere, match: "all" };
}
