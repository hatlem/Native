-- "Anlegg & Transport" (Maskinentreprenørenes Forbund) is branded "AT.no" — its
-- masthead and website. The title had no aliases, so catalog search found it
-- only via "Anlegg"/"Transport"; searching "AT.no" or "AT" returned nothing.
-- Title.searchTsv (a STORED generated tsvector, weight A over name + aliases)
-- recomputes automatically on this UPDATE.
--
-- Why three aliases: src/lib/catalog-search.ts strips non-alphanumerics from
-- the query, so typing "AT.no" actually searches the lexeme prefix `atno:*`.
-- The 'simple' dictionary tokenizes "AT.no" to the host lexeme `at.no` (the dot
-- is kept), which `atno:*` does NOT match — but "ATno" tokenizes to `atno`,
-- which it does. So store: AT.no (display/exact), AT (abbreviation), ATno
-- (matches the dot-stripped query). Verified against Postgres 'simple' config.
--
-- Idempotent: merges with any existing aliases and de-duplicates.
UPDATE "Title"
SET "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['AT.no', 'AT', 'ATno']))
WHERE "slug" = 'anlegg-transport-no';
