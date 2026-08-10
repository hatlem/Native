-- Seed curated keywords[] (buyer vocabulary) and domain-brand aliases[] on
-- known trade-press titles whose own name/category/vertical don't spell out
-- the terms a buyer actually searches (e.g. "lastebil", "havbruk").
--
-- This is belt-and-braces alongside the synonym-expansion query layer
-- (src/lib/search-synonyms.ts): even if a future query-side change regresses
-- expansion, these titles still carry the vocabulary on the row itself,
-- which the FTS weight-B keywords index and the ILIKE fallback's
-- keywords/aliases hasSome both read directly.
--
-- Idempotent: DISTINCT-unnest merge, safe to re-run; a no-op for any slug
-- that doesn't exist in a given environment (UPDATE simply touches 0 rows).
--
-- NOTE on scope vs. the originating analysis: TU.no (tu-no) was flagged as
-- a transport-trade title needing this seed, but its live row (verified via
-- MCP native_get_title before writing this migration) is IT & Tech
-- (vertical "B2B – IT & Tech", audience "IT professionals") and already
-- carries curated keywords/aliases from an earlier pass
-- (["teknologi","industri","ingeniør","innovasjon","B2B","native"]). Adding
-- transport/logistics keywords to it would misclassify a real title, so
-- it's deliberately left untouched here.

-- ---------- Transport & logistics / fleet trade press ----------

UPDATE "Title" SET
  keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
    'anlegg', 'anleggsmaskin', 'entreprenør', 'maskin', 'transport', 'logistikk'
  ])),
  "updatedAt" = now()
WHERE slug = 'anlegg-transport-no';

UPDATE "Title" SET
  keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
    'buss', 'kollektivtransport', 'transport', 'logistikk'
  ])),
  aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['Buss.no', 'Bussno'])),
  "updatedAt" = now()
WHERE slug = 'buss-magasinet-no';

UPDATE "Title" SET
  keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
    'yrkestrafikk', 'vognpark', 'lastebil', 'transport', 'logistikk'
  ])),
  aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['YTF.no', 'YTFno'])),
  "updatedAt" = now()
WHERE slug = 'yrkestrafikk-no';

-- YrkesBil is not in prisma/data/medier_alle.csv (added directly in prod);
-- verified live via MCP native_get_title before writing this. WHERE-only
-- match makes it a safe no-op if the slug ever changes.
UPDATE "Title" SET
  keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
    'yrkesbil', 'varebil', 'vognpark', 'transport', 'logistikk'
  ])),
  aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['YrkesBil.no', 'YrkesBilno'])),
  "updatedAt" = now()
WHERE slug = 'yrkesbil-no';

-- ---------- Aquaculture / seafood trade press ----------

UPDATE "Title" SET
  keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
    'laks', 'oppdrett', 'havbruk', 'akvakultur', 'salmon', 'sjømat'
  ])),
  "updatedAt" = now()
WHERE slug = 'salmon-business-no';

-- Norsk Sjømat / Fretta.no: present in prisma/data/medier_alle.csv but no
-- prod slug could be confirmed via MCP at authoring time (native_get_title
-- returned null for the guessed slugs) — match by exact name instead so
-- this is a genuine no-op if the row isn't there, rather than silently
-- guessing wrong and hitting an unrelated row.
UPDATE "Title" SET
  keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
    'sjømat', 'fiskeri', 'havbruk', 'fisk'
  ])),
  "updatedAt" = now()
WHERE name = 'Norsk Sjømat'
  AND EXISTS (SELECT 1 FROM "Title" WHERE name = 'Norsk Sjømat');

UPDATE "Title" SET
  keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
    'sjømat', 'fiskeri', 'havbruk', 'fisk'
  ])),
  "updatedAt" = now()
WHERE name = 'Fretta.no'
  AND EXISTS (SELECT 1 FROM "Title" WHERE name = 'Fretta.no');
