// Wraps Postgres FTS for the catalog: query against the `searchTsv`
// generated column (name + aliases weight A, category + keywords weight B,
// audienceNote + description weight C — see migration
// 20260604170000_fts_keywords_description), fall back to plain ILIKE when
// the query is missing. Returns matching Title ids so the caller can keep
// using Prisma includes for the rest.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function toTsQuery(raw: string): string {
  // Strip anything that isn't a letter/number; tsquery is strict about
  // operators and we want a forgiving "match every word" feel.
  const terms = raw
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{Letter}\p{Number}]/gu, ""))
    .filter((t) => t.length >= 2);
  if (terms.length === 0) return "";
  return terms.map((t) => `${t}:*`).join(" & ");
}

export async function searchTitleIds(query: string): Promise<string[] | null> {
  const q = query.trim();
  if (!q) return null;
  const tsq = toTsQuery(q);
  if (!tsq) return null;
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "Title" WHERE "searchTsv" @@ to_tsquery('simple', ${tsq})`,
  );
  return rows.map((r) => r.id);
}
