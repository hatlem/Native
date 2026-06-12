-- Curated semantic inclusions: offer-level deliverables only (what the
-- BUYER gets for this product), mapped from internal quote notes.
-- Publication-level reach is deliberately excluded. Join on title slug +
-- exact product name; quote-created products only. Unmatched rows = no-op.

CREATE OR REPLACE FUNCTION _seed_inc(p_slug text, p_name text, p_inc jsonb)
RETURNS void AS $$
BEGIN
  UPDATE "Product" p SET "inclusions" = p_inc
  FROM "Title" t
  WHERE p."titleId" = t.id AND t.slug = p_slug AND p.name = p_name
    AND p."confirmedSource" LIKE 'PriceQuote:%';
END; $$ LANGUAGE plpgsql;

-- ETC (SE): puff på ettan, 100k visn/uke i 3 uker
SELECT _seed_inc('dagens-etc-se', 'Native-artikel (ETC.se)',
  '{"frontpage": true, "viewsPerWeek": 100000, "durationWeeks": 3}');

-- Dagens Medicin (SE): contentredaktör skriver; print/webb-varianter
SELECT _seed_inc('dagens-medicin-se', 'Native grundpaket (print helsida + 2 v webb)',
  '{"production": "PUBLISHER", "print": true, "durationWeeks": 2}');
SELECT _seed_inc('dagens-medicin-se', 'Native enbart helsida (tidning)',
  '{"production": "PUBLISHER", "print": true}');
SELECT _seed_inc('dagens-medicin-se', 'Native enbart webb (2 veckor)',
  '{"production": "PUBLISHER", "durationWeeks": 2}');

-- Amedia Oslo: 80k visninger/mnd per pakke
SELECT _seed_inc('akersposten-no', 'Native 1 sak (80k visn/mnd)', '{"viewsPerMonth": 80000}');
SELECT _seed_inc('akersposten-no', 'Native 2 saker (80k visn/mnd)', '{"viewsPerMonth": 80000}');
SELECT _seed_inc('akersposten-no', 'Native 3 saker (80k visn/mnd)', '{"viewsPerMonth": 80000}');
SELECT _seed_inc('ullern-avis-no', 'Native 1 sak (80k visn/mnd)', '{"viewsPerMonth": 80000}');

-- Aller DK: sponsoreret artikel med deling på medie (SoMe-distribusjon)
SELECT _seed_inc('se-og-h-r-dk', 'Sponsoreret artikel', '{"social": true}');
SELECT _seed_inc('billed-bladet-dk', 'Sponsoreret artikel', '{"social": true}');
SELECT _seed_inc('familie-journal-dk', 'Sponsoreret artikel', '{"social": true}');
SELECT _seed_inc('ude-og-hjemme-dk', 'Sponsoreret artikel', '{"social": true}');
SELECT _seed_inc('spis-bedre-dk', 'Sponsoreret artikel', '{"social": true}');

-- Chef (SE): inkl produktion + distribusjon webb/nyhetsbrev/SoMe
SELECT _seed_inc('chef-se', 'Native digital (1 artikel)',
  '{"production": "PUBLISHER", "newsletter": true, "social": true}');
SELECT _seed_inc('chef-se', 'Native digital (2 artiklar)',
  '{"production": "PUBLISHER", "newsletter": true, "social": true}');
SELECT _seed_inc('chef-se', 'Native digital (3 artiklar)',
  '{"production": "PUBLISHER", "newsletter": true, "social": true}');
SELECT _seed_inc('chef-se', 'Print helsida (Tidningen Chef) tillägg', '{"print": true}');

-- SB Media (Café/King): garanti 5 000 läsningar/2 veckor
SELECT _seed_inc('cafe-se', 'Native (redaktionen skriver)',
  '{"production": "PUBLISHER", "readsTotal": 5000, "durationWeeks": 2}');
SELECT _seed_inc('cafe-se', 'Native (färdig text)',
  '{"production": "PLATFORM", "readsTotal": 5000, "durationWeeks": 2}');
SELECT _seed_inc('king-magazine-se', 'Native (redaktionen skriver)',
  '{"production": "PUBLISHER", "readsTotal": 5000, "durationWeeks": 2}');
SELECT _seed_inc('king-magazine-se', 'Native (färdig text)',
  '{"production": "PLATFORM", "readsTotal": 5000, "durationWeeks": 2}');

-- Läkartidningen (SE): Informas Content Studio produserer
SELECT _seed_inc('lakartidningen-se', 'Native komplett (webb+nyhetsbrev+print+ägande)',
  '{"production": "PUBLISHER", "newsletter": true, "print": true, "rights": true, "durationWeeks": 1}');
SELECT _seed_inc('lakartidningen-se', 'Native endast webb', '{"production": "PUBLISHER"}');
SELECT _seed_inc('lakartidningen-se', 'Native endast print',
  '{"production": "PUBLISHER", "print": true}');

-- Världen Idag (SE)
SELECT _seed_inc('varlden-idag-se', 'Dagstidning Native (helsida)',
  '{"production": "PUBLISHER", "print": true}');
SELECT _seed_inc('varlden-idag-se', 'Dagstidning Native (mittuppslag)',
  '{"production": "PUBLISHER", "print": true}');
SELECT _seed_inc('varlden-idag-se', 'Digital Native (webbannons)', '{"frontpage": true}');

-- idenyt (DK): garanterte læsninger, produksjon inkludert
SELECT _seed_inc('idenyt-dk', 'Native idenyt.dk (5 000 læsninger)',
  '{"production": "PUBLISHER", "readsTotal": 5000}');
SELECT _seed_inc('idenyt-dk', 'Native idenyt.dk (8 000 læsninger)',
  '{"production": "PUBLISHER", "readsTotal": 8000}');
SELECT _seed_inc('idenyt-dk', 'Native idenyt.dk (15 000 læsninger)',
  '{"production": "PUBLISHER", "readsTotal": 15000}');

-- Dagens Samhälle (SE): sökbar 1 år, puff 14 dager, produksjon + äganderätt
SELECT _seed_inc('dagens-samhalle-se', 'Digital nativeartikel',
  '{"production": "PUBLISHER", "rights": true, "searchableMonths": 12, "durationWeeks": 2}');
SELECT _seed_inc('dagens-samhalle-se', 'Digital nativeartikel + helsida print (1 utgåva)',
  '{"production": "PUBLISHER", "rights": true, "searchableMonths": 12, "print": true, "durationWeeks": 2}');

-- Market / Byggvärlden / Journalisten (SE)
SELECT _seed_inc('market-se', 'Native (market.se, per vecka)',
  '{"production": "PUBLISHER", "durationWeeks": 1}');
SELECT _seed_inc('byggva-rlden-se', 'Native digitalt (per vecka)',
  '{"newsletter": true, "durationWeeks": 1}');
SELECT _seed_inc('journalisten-se', 'Native-puff i nyhetsbrev', '{"newsletter": true}');

-- Egmont-titler: produksjon utifrån brief inngår
SELECT _seed_inc('icakuriren-se', 'Native artikel (per sajt)', '{"production": "PUBLISHER"}');
SELECT _seed_inc('hemmets-journal-se', 'Native artikel (per sajt)', '{"production": "PUBLISHER"}');
SELECT _seed_inc('min-ha-st-se', 'Native artikel (per sajt)', '{"production": "PUBLISHER"}');

DROP FUNCTION _seed_inc(text, text, jsonb);
