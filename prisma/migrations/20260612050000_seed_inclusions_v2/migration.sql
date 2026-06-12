-- Hand-curated inclusions v2: every row verified against the source
-- quote by a human-reviewed pass (swarm output used only as draft).
-- Corrections vs draft: searchableMonths removed where the source only
-- states it for the recept add-on; HBL/VBL production dropped (publisher
-- charges extra); slug pattern å/ä/ö -> a- fixed for three SE titles.
-- Unconditional updates: hand-curation supersedes earlier seeds.

CREATE OR REPLACE FUNCTION _seed_inc(p_slug text, p_name text, p_inc jsonb)
RETURNS void AS $fn$
BEGIN
  UPDATE "Product" p SET "inclusions" = p_inc
  FROM "Title" t
  WHERE p."titleId" = t.id AND t.slug = p_slug AND p.name = p_name
    AND p."confirmedSource" LIKE 'PriceQuote:%';
END; $fn$ LANGUAGE plpgsql;

-- Slug corrections: re-issue rows that silently no-op'ed in v1
SELECT _seed_inc('dagens-samha-lle-se', 'Digital nativeartikel',
  '{"production": "PUBLISHER", "rights": true, "searchableMonths": 12, "durationWeeks": 2}');
SELECT _seed_inc('dagens-samha-lle-se', 'Digital nativeartikel + helsida print (1 utgåva)',
  '{"production": "PUBLISHER", "rights": true, "searchableMonths": 12, "print": true, "durationWeeks": 2}');
SELECT _seed_inc('la-kartidningen-se', 'Native komplett (webb+nyhetsbrev+print+ägande)',
  '{"production": "PUBLISHER", "newsletter": true, "print": true, "rights": true, "durationWeeks": 1}');
SELECT _seed_inc('la-kartidningen-se', 'Native endast webb', '{"production": "PUBLISHER"}');
SELECT _seed_inc('la-kartidningen-se', 'Native endast print', '{"production": "PUBLISHER", "print": true}');
SELECT _seed_inc('va-rlden-idag-se', 'Dagstidning Native (helsida)', '{"production": "PUBLISHER", "print": true}');
SELECT _seed_inc('va-rlden-idag-se', 'Dagstidning Native (mittuppslag)', '{"production": "PUBLISHER", "print": true}');
SELECT _seed_inc('va-rlden-idag-se', 'Digital Native (webbannons)', '{"frontpage": true, "video": true}');

-- Aller SE: Creative Studio-produserte pakker med sidevisningsgaranti
SELECT _seed_inc('allas-se', 'Native Digital Allas – Paket 1 (10k sidv, 1 vecka)',
  '{"production": "PUBLISHER", "viewsTotal": 10000, "durationWeeks": 1}');
SELECT _seed_inc('allas-se', 'Native Digital Allas – Paket 2 (25k sidv, 1-2 veckor)',
  '{"production": "PUBLISHER", "viewsTotal": 25000}');
SELECT _seed_inc('allas-se', 'Native Digital Allas – Paket 3 (50k sidv, 3-4 veckor)',
  '{"production": "PUBLISHER", "viewsTotal": 50000}');
SELECT _seed_inc('allas-se', 'Native SOME Video (Aller-nätverket, 1 episod)', '{"social": true, "video": true}');
SELECT _seed_inc('allas-se', 'Native Video (Aller-nätverket, 1 episod)', '{"social": true, "video": true}');
SELECT _seed_inc('ha-nt-i-veckan-se', 'Native Digital Hänt.se – Standard (10k sidv/vecka)',
  '{"viewsPerWeek": 10000, "durationWeeks": 1}');
SELECT _seed_inc('ha-nt-i-veckan-se', 'Native Digital Hänt.se – Paket 1 (20k sidv, 1 vecka)',
  '{"viewsTotal": 20000, "durationWeeks": 1}');
SELECT _seed_inc('ha-nt-i-veckan-se', 'Native Digital Hänt.se – Paket 2 (40k sidv, 1-2 veckor)', '{"viewsTotal": 40000}');
SELECT _seed_inc('ha-nt-i-veckan-se', 'Native Digital Hänt.se – Paket 3 (80k sidv, 3-4 veckor)', '{"viewsTotal": 80000}');
SELECT _seed_inc('ha-nt-extra-se', 'Hänt Extra – Helsida (print native)', '{"print": true}');
SELECT _seed_inc('ha-nt-extra-se', 'Hänt Extra – Uppslag (print native)', '{"print": true}');
SELECT _seed_inc('elle-mat-vin-se', 'Native Recept – Paket 1 (15k sidv, 1 vecka)', '{"viewsTotal": 15000, "durationWeeks": 1}');
SELECT _seed_inc('elle-mat-vin-se', 'Native Recept – Paket 2 (25k sidv, 1-2 veckor)', '{"viewsTotal": 25000}');
SELECT _seed_inc('elle-mat-vin-se', 'Native Recept – Paket 3 (50k sidv, 3-4 veckor)', '{"viewsTotal": 50000}');
SELECT _seed_inc('elle-mat-vin-se', 'Native Recept add-on – recept skapat av Aller (per recept)', '{"production": "PUBLISHER"}');
SELECT _seed_inc('elle-mat-vin-se', 'Native Recept add-on – integration i matuniversum (per år)', '{"searchableMonths": 12}');
SELECT _seed_inc('femina-se', 'Native Recept – Paket 1 (15k sidv, 1 vecka)', '{"viewsTotal": 15000, "durationWeeks": 1}');
SELECT _seed_inc('femina-se', 'Native Recept – Paket 2 (25k sidv, 1-2 veckor)', '{"viewsTotal": 25000}');
SELECT _seed_inc('femina-se', 'Native Recept – Paket 3 (50k sidv, 3-4 veckor)', '{"viewsTotal": 50000}');
SELECT _seed_inc('femina-se', 'Native Recept add-on – recept skapat av Aller (per recept)', '{"production": "PUBLISHER"}');
SELECT _seed_inc('femina-se', 'Native Recept add-on – integration i matuniversum (per år)', '{"searchableMonths": 12}');

-- Finansavisen: Brand Studio-intro (videointervju + artikkel)
SELECT _seed_inc('finansavisen-no', 'Premium native SOV', '{"durationWeeks": 1}');
SELECT _seed_inc('finansavisen-no', 'FA Brand Studio studioprod-intro',
  '{"production": "PUBLISHER", "frontpage": true, "rights": true, "viewsTotal": 3000, "video": true}');

-- Chef: full pakke — produksjon, fotograf, kanaler, rapport
SELECT _seed_inc('chef-se', 'Native digital (1 artikel)',
  '{"production": "PUBLISHER", "newsletter": true, "socialChannels": ["LinkedIn", "Facebook", "Instagram"], "photographer": true, "report": true}');
SELECT _seed_inc('chef-se', 'Native digital (2 artiklar)',
  '{"production": "PUBLISHER", "newsletter": true, "socialChannels": ["LinkedIn", "Facebook", "Instagram"], "photographer": true, "report": true, "articles": 2}');
SELECT _seed_inc('chef-se', 'Native digital (3 artiklar)',
  '{"production": "PUBLISHER", "newsletter": true, "socialChannels": ["LinkedIn", "Facebook", "Instagram"], "photographer": true, "report": true, "articles": 3}');
SELECT _seed_inc('chef-se', 'Print helsida (Tidningen Chef) tillägg', '{"print": true}');

-- Amedia Oslo: 10 % SOV-presisering på 80k-pakkene
SELECT _seed_inc('akersposten-no', 'Native 1 sak (80k visn/mnd)', '{"viewsPerMonth": 80000, "sovPct": 10}');
SELECT _seed_inc('akersposten-no', 'Native 2 saker (80k visn/mnd)', '{"viewsPerMonth": 80000, "sovPct": 10, "articles": 2}');
SELECT _seed_inc('akersposten-no', 'Native 3 saker (80k visn/mnd)', '{"viewsPerMonth": 80000, "sovPct": 10, "articles": 3}');
SELECT _seed_inc('ullern-avis-no', 'Native 1 sak (80k visn/mnd)', '{"viewsPerMonth": 80000, "sovPct": 10}');

-- Bonnier Svenskfinland: 100 % SOV, front-puff, >100k visninger/uke
SELECT _seed_inc('hufvudstadsbladet-fi', 'Native (Hufvudstadsbladet, per vecka)',
  '{"durationWeeks": 1, "frontpage": true, "viewsPerWeek": 100000, "sovPct": 100}');
SELECT _seed_inc('vasabladet-fi', 'Native (Vasabladet, per vecka)',
  '{"durationWeeks": 1, "frontpage": true, "viewsPerWeek": 100000, "sovPct": 100}');

-- Diverse verifiserte enkeltrader
SELECT _seed_inc('journalisten-se', 'Native-puff i nyhetsbrev', '{"newsletter": true, "durationWeeks": 1}');
SELECT _seed_inc('neurologi-i-sverige-se', 'Nativeannons i nyhetsbrev (Neurologi i Sverige)', '{"newsletter": true, "durationWeeks": 1}');
SELECT _seed_inc('cykling-se', 'Native på hemsida + puff i nyhetsmail', '{"newsletter": true}');
SELECT _seed_inc('sa-gat-no', 'Native artikkel / video-native (per uke)', '{"production": "PLATFORM", "durationWeeks": 1, "video": true}');
SELECT _seed_inc('folkemusikk-no', 'Content/native helside', '{"production": "PLATFORM", "print": true}');

DROP FUNCTION _seed_inc(text, text, jsonb);
