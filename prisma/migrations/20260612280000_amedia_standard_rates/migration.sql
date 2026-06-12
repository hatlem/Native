-- Amedia national standard rates -> the whole Amedia (NO) portfolio.
-- Source: Maria Hagland (Salgssjef, Amedia Annonse Rogaland) 2026-06-12,
-- verbatim: "de samme digitale ordinærprisene som gjelder på tvers av
-- alle våre aviser". User approved the portfolio rollout 2026-06-12.
--
-- Two confirmed CPM products per active Amedia (NO) title:
--   Native 1-/2-saksløsning  300 NOK CPM   (one landing page)
--   Native 3-saksløsning     400 NOK CPM   (three landing pages)
-- productionFee = 4 500 (the unavoidable floor: "ferdigmateriell" set in
-- their template; full Innholdsbyrå production is 18 000 — the ladder is
-- documented in includedText for the desk). CPM products never band, so
-- the catalog shows "≈ 345 NOK CPM"-style unit rates + the
-- production-comes-extra note.
-- Idempotent via confirmedSource guard; negotiated deals (Akersposten/
-- Ullern flats, Gjesdalbuen package) are untouched — these rows are
-- additive.

INSERT INTO "Product" (
  id, "titleId", type, name, description, "pricingModel", "basePrice",
  currency, visibility, active, bookable, "confirmedAt", "confirmedSource",
  "includedText", inclusions, "productionFee", "createdAt", "updatedAt"
)
SELECT
  'amed300_' || md5(t.id), t.id, 'NATIVE_ARTICLE',
  'Native 1-saksløsning (Amedia ordinærpris)',
  'Distribusjon av native-artikkel med én landingsside (annonseinngang). Nasjonal ordinærpris, alle Amedia-aviser.',
  'CPM', 300, 'NOK', 'INDICATIVE', true, true, now(),
  'AmediaOrdinaer-2026-06-12 (Maria Hagland, Amedia Annonse)',
  'INBOUND 06-12 Maria Hagland (Amedia Annonse): nasjonale ordinærpriser, alle Amedia-aviser. Distribusjon 1-/2-sak 300 CPM. Produksjon (Amedia Innholdsbyrå): full artikkel m/utreise+intervju+foto 18 000; video m/artikkel fra 35 500; ferdigmateriell/enkel 4 500–10 500. Kan kombineres med fast forsideplass 1–2 dager.',
  '{"articles": 1}'::jsonb, 4500, now(), now()
FROM "Title" t
JOIN "Publisher" p ON p.id = t."publisherId"
WHERE p.name = 'Amedia (NO)' AND t.active
  AND NOT EXISTS (
    SELECT 1 FROM "Product" pr
    WHERE pr."titleId" = t.id
      AND pr."confirmedSource" LIKE 'AmediaOrdinaer%'
      AND pr."basePrice" = 300
  );

INSERT INTO "Product" (
  id, "titleId", type, name, description, "pricingModel", "basePrice",
  currency, visibility, active, bookable, "confirmedAt", "confirmedSource",
  "includedText", inclusions, "productionFee", "createdAt", "updatedAt"
)
SELECT
  'amed400_' || md5(t.id), t.id, 'NATIVE_ARTICLE',
  'Native 3-saksløsning (Amedia ordinærpris)',
  'Distribusjon av native med tre landingssider i samme annonseinngang (f.eks. artikkel + kundecase + nettbutikk). Nasjonal ordinærpris.',
  'CPM', 400, 'NOK', 'INDICATIVE', true, true, now(),
  'AmediaOrdinaer-2026-06-12 (Maria Hagland, Amedia Annonse)',
  'INBOUND 06-12 Maria Hagland (Amedia Annonse): nasjonale ordinærpriser, alle Amedia-aviser. Distribusjon 3-sak 400 CPM. Produksjon (Amedia Innholdsbyrå): full artikkel 18 000; video m/artikkel fra 35 500; ferdigmateriell/enkel 4 500–10 500.',
  '{"articles": 3}'::jsonb, 4500, now(), now()
FROM "Title" t
JOIN "Publisher" p ON p.id = t."publisherId"
WHERE p.name = 'Amedia (NO)' AND t.active
  AND NOT EXISTS (
    SELECT 1 FROM "Product" pr
    WHERE pr."titleId" = t.id
      AND pr."confirmedSource" LIKE 'AmediaOrdinaer%'
      AND pr."basePrice" = 400
  );

-- pricingAsOf so the freshness audit knows these numbers are from today.
UPDATE "Title" t SET "pricingAsOf" = now(), "updatedAt" = now()
FROM "Publisher" p
WHERE p.id = t."publisherId" AND p.name = 'Amedia (NO)' AND t.active
  AND (t."pricingAsOf" IS NULL OR t."pricingAsOf" < now() - interval '1 day');
