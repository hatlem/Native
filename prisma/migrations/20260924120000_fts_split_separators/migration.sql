-- Make catalog FTS tokenize the way the query side does (catalog-search.ts
-- normalizeWords splits on every non-letter/number), and index the website
-- host so buyers can search by domain.
--
-- 1. "/" and "\" become word breaks in every field. Postgres's parser reads
--    "Bärgslagsbladet/Arboga Tidning" as the path lexeme '/arboga', so the
--    query arboga:* never matched; 24 live titles ("Österreich/oe24",
--    "NU 7 dagar - Klippan/Örkelljunga/Perstorp", …) had unsearchable parts.
-- 2. name + aliases are ALSO indexed with "." "-" "_" split out, alongside
--    the original tokens: "Bobedre.dk" is one host lexeme 'bobedre.dk', which
--    the query dk:* can never prefix-match. The originals stay, so nothing
--    that matched before stops matching.
-- 3. The website host is indexed whole (weight B) as one host lexeme
--    ('vg.no', 't-online.de'); buildTsQuery ORs a typed domain against it.
--    Deliberately NOT split: a bare TLD word would make "de"/"no" match
--    every site in that country.
--
-- Verified read-only against prod before shipping: every slash-name part
-- now matches, and for a 30-query sample the new column returns a superset
-- of the old one (0 lost matches).
--
-- searchTsv is a STORED generated column managed outside schema.prisma
-- (see 20260701020000_fts_vertical_tags); translate / regexp_replace / lower
-- are IMMUTABLE, as generated columns require.
CREATE OR REPLACE FUNCTION immutable_text_array_join(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT array_to_string($1, ' ') $$;

DROP INDEX IF EXISTS "Title_searchTsv_idx";
ALTER TABLE "Title" DROP COLUMN IF EXISTS "searchTsv";
ALTER TABLE "Title"
  ADD COLUMN "searchTsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', translate(coalesce("name", ''), '/\', '  ')), 'A') ||
    setweight(to_tsvector('simple', translate(immutable_text_array_join("aliases"), '/\', '  ')), 'A') ||
    setweight(to_tsvector('simple', translate(coalesce("name", '') || ' ' || immutable_text_array_join("aliases"), '/\.-_', '     ')), 'A') ||
    setweight(to_tsvector('simple', regexp_replace(lower(coalesce("websiteUrl", '')), '^([a-z][a-z0-9+.-]*://)?(www\.)?([^/:?#]*).*$', '\3')), 'B') ||
    setweight(to_tsvector('simple', translate(coalesce("category", ''), '/\', '  ')), 'B') ||
    setweight(to_tsvector('simple', translate(immutable_text_array_join("keywords"), '/\', '  ')), 'B') ||
    setweight(to_tsvector('simple', translate(coalesce("vertical", ''), '/\', '  ')), 'B') ||
    setweight(to_tsvector('simple', translate(coalesce("audienceNote", ''), '/\', '  ')), 'C') ||
    setweight(to_tsvector('simple', translate(coalesce("description", ''), '/\', '  ')), 'C') ||
    setweight(to_tsvector('simple', translate(coalesce("tags", ''), '/\', '  ')), 'C')
  ) STORED;
CREATE INDEX "Title_searchTsv_idx" ON "Title" USING GIN ("searchTsv");
