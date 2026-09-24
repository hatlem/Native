// Wraps Postgres FTS for the catalog: query against the `searchTsv`
// generated column (name + aliases weight A, category + keywords weight B,
// vertical weight B, audienceNote + description weight C, legacy tags
// weight C, website host weight B — see migrations
// 20260604170000_fts_keywords_description, 20260701020000_fts_vertical_tags
// and 20260924120000_fts_split_separators), fall back to plain ILIKE (extended
// with the same synonym expansion, plus keywords/aliases array lookups)
// when FTS finds nothing or the query can't build a tsquery at all.
// Returns matching Title ids so the caller can keep using Prisma includes
// for the rest.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { expandTerm } from "@/lib/search-synonyms";

// Guard against pathological input blowing up the tsquery (a title with a
// huge synonym group, or a query with many words) — 15 synonyms per word is
// comfortably above our largest group.
const MAX_SYNONYMS_PER_WORD = 15;

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
export function buildTsQuery(raw: string): string {
  const parts: string[] = [];
  for (const chunk of raw.split(/\s+/)) {
    // A domain ("vg.no", "t-online.de", a pasted URL) also matches the
    // title's website host, indexed whole as a host lexeme. The host's split
    // words stay as the alternative so "AT.no" still finds the name "AT.no";
    // a URL's scheme/www/path never become search words.
    const host = domainOf(chunk);
    const words = normalizeWords(host ?? chunk);
    if (words.length === 0) continue;
    const group = words.map(wordTerm).join(" & ");
    parts.push(host ? `(${host}:* | ${words.length > 1 ? `(${group})` : group})` : group);
  }
  return parts.join(" & ");
}

function wordTerm(w: string): string {
  const variants = expandTerm(w).slice(0, MAX_SYNONYMS_PER_WORD);
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

/**
 * Prisma OR-block fallback for when FTS returns zero rows (or the query
 * can't produce a tsquery at all): substring match over the human-readable
 * text fields, plus synonym-expanded array membership over the curated
 * `keywords`/`aliases` columns. Mirrors the shape previously inlined at
 * catalog/page.tsx's search where-builder, extended with synonym variants.
 */
export function buildIlikeFallbackWhere(q: string): Prisma.TitleWhereInput {
  const trimmed = q.trim();
  if (!trimmed) return {};

  const variants = new Set<string>([trimmed]);
  for (const w of normalizeWords(trimmed)) {
    for (const syn of expandTerm(w)) variants.add(syn);
  }
  const variantList = Array.from(variants);

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
      { keywords: { hasSome: variantList } },
      { aliases: { hasSome: variantList } },
    ],
  };
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

export async function searchTitleIds(query: string): Promise<string[] | null> {
  const q = query.trim();
  if (!q) return null;
  const tsq = buildTsQuery(q);
  if (!tsq) return null;
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "Title" WHERE "searchTsv" @@ to_tsquery('simple', ${tsq})`,
  );
  return rows.map((r) => r.id);
}
