-- Generic, idempotent backfill for "the dedup-without-alias lesson"
-- (see 20260612250000_fold_akersposten_dupes): whenever a duplicate Title
-- is deactivated with a discontinuedNote of the form
-- "... slått sammen med <survivor-slug> ..." (the convention that
-- migration established), the dead title's OWN name must be folded into
-- the survivor's aliases — otherwise catalog FTS (which indexes
-- name + aliases at weight A) stops matching the name buyers actually
-- searched for the moment the duplicate is merged away.
--
-- As of this migration, every existing "slått sammen med <slug>" row
-- already had its alias folded by the same migration that deactivated it,
-- so this is a no-op against current data — it exists as a standing
-- safety net so a FUTURE merge that forgets the fold (or a merge done
-- outside a migration) gets caught automatically. Guarded with
-- WHERE EXISTS / NOT ... = ANY() throughout so it is safe to run
-- regardless of what prod data looks like at deploy time.

-- Pass 1: fold the dead title's display name into the survivor's aliases.
--
-- Uses a correlated subquery (array_agg over all matching dead titles),
-- NOT a plain UPDATE...FROM self-join: Postgres's documented UPDATE...FROM
-- semantics apply only ONE of several matching FROM rows per target row
-- when the join is one-to-many, which is exactly what happens when two or
-- more duplicates fold into the same survivor — the self-join form
-- silently drops all but one dead title's name. The correlated subquery
-- aggregates every not-yet-present name for a given survivor in one shot.
UPDATE "Title" s
SET aliases = s.aliases || (
  SELECT array_agg(DISTINCT d.name)
  FROM "Title" d
  WHERE d.id <> s.id
    AND d."discontinuedNote" ~ 'slått sammen med [a-z0-9-]+'
    AND s.slug = substring(d."discontinuedNote" from 'slått sammen med ([a-z0-9-]+)')
    AND d.name <> ALL(s.aliases)
), "updatedAt" = now()
WHERE EXISTS (
  SELECT 1
  FROM "Title" d
  WHERE d.id <> s.id
    AND d."discontinuedNote" ~ 'slått sammen med [a-z0-9-]+'
    AND s.slug = substring(d."discontinuedNote" from 'slått sammen med ([a-z0-9-]+)')
    AND d.name <> ALL(s.aliases)
);

-- Pass 2: domain-brand names (e.g. "AT.no") tokenize with the dot kept
-- under the 'simple' dictionary, but catalog-search strips punctuation
-- from the query before matching (see 20260619010000_at_no_alias) — so
-- also store the dot-stripped form when the dead title's name looks like
-- a domain (contains a period). Same correlated-subquery shape as Pass 1
-- and for the same reason: a UPDATE...FROM self-join would only fold one
-- of several matching dead titles' dot-stripped names per survivor.
UPDATE "Title" s
SET aliases = s.aliases || (
  SELECT array_agg(DISTINCT replace(d.name, '.', ''))
  FROM "Title" d
  WHERE d.id <> s.id
    AND d."discontinuedNote" ~ 'slått sammen med [a-z0-9-]+'
    AND s.slug = substring(d."discontinuedNote" from 'slått sammen med ([a-z0-9-]+)')
    AND d.name LIKE '%.%'
    AND replace(d.name, '.', '') <> ALL(s.aliases)
), "updatedAt" = now()
WHERE EXISTS (
  SELECT 1
  FROM "Title" d
  WHERE d.id <> s.id
    AND d."discontinuedNote" ~ 'slått sammen med [a-z0-9-]+'
    AND s.slug = substring(d."discontinuedNote" from 'slått sammen med ([a-z0-9-]+)')
    AND d.name LIKE '%.%'
    AND replace(d.name, '.', '') <> ALL(s.aliases)
);
