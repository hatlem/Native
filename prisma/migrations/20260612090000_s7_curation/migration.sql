-- S7: full hand-curated review of every confirmed product (372 rows
-- reviewed against source quotes). Pattern families first, then
-- per-title rows. New production value ADVERTISER ("you supply the
-- finished article") corrects v2 rows that wrongly claimed PLATFORM.

CREATE OR REPLACE FUNCTION _seed_inc(p_slug text, p_name text, p_inc jsonb)
RETURNS void AS $fn$
BEGIN
  UPDATE "Product" p SET "inclusions" = p_inc
  FROM "Title" t
  WHERE p."titleId" = t.id AND t.slug = p_slug AND p.name = p_name
    AND p."confirmedSource" LIKE 'PriceQuote:%';
END; $fn$ LANGUAGE plpgsql;

-- ============ PATTERN FAMILIES (name-matched across titles) ============

-- Polaris Media video-native (Prerolls/Reels, ~25 aviser)
UPDATE "Product" SET "inclusions" = '{"video": true}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND ("name" LIKE 'Video – Prerolls (Polaris%' OR "name" LIKE 'Video – Reels (Polaris%');

-- Amedia-pakker på tvers av titler
UPDATE "Product" SET "inclusions" = '{"articles": 2}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND "name" = 'Native 2-saker (±video)';
UPDATE "Product" SET "inclusions" = '{"articles": 3}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND "name" = 'Native 3-saker (±video)';
UPDATE "Product" SET "inclusions" = '{"production": "PUBLISHER"}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND "name" = 'Produksjon – full artikkelproduksjon';
UPDATE "Product" SET "inclusions" = '{"production": "ADVERTISER"}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND "name" = 'Produksjon – tilpasning ferdig materiell';

-- Salgsfabrikken partnerinnhold (avfallsbransjen/biogassbransjen/cnytt/hydrogen24)
UPDATE "Product" SET "inclusions" = '{"production": "ADVERTISER", "frontpage": true, "newsletter": true, "durationWeeks": 2}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND "name" = 'Partnerinnhold / content – 2 uker';
UPDATE "Product" SET "inclusions" = '{"production": "ADVERTISER", "frontpage": true, "newsletter": true, "durationWeeks": 4}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND "name" = 'Partnerinnhold / content – 4 uker';

-- NMF båt-titler (Båtliv/Båtmagasinet/Magasinet Båt/Seilmagasinet)
UPDATE "Product" SET "inclusions" = '{"durationWeeks": 1}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND "name" = 'Digital native – større (per uke)';
UPDATE "Product" SET "inclusions" = '{"video": true}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND ("name" LIKE 'WebTV advertorial%' OR "name" LIKE 'Web-TV advertorial%');
UPDATE "Product" SET "inclusions" = '{"newsletter": true}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND ("name" LIKE 'Nyhetsbrev native%' OR "name" = 'Nyhedsbrev-banner (pr. gang)');

-- Aller DK sponsorerte artikler (deling på medie)
UPDATE "Product" SET "inclusions" = '{"social": true}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND "name" = 'Sponsoreret artikel';

-- Egmont print-helsider + Media-Partners tekstannoncer (ren print)
UPDATE "Product" SET "inclusions" = '{"print": true}'
WHERE "confirmedSource" LIKE 'PriceQuote:%' AND "inclusions" IS NULL
  AND ("name" LIKE 'Print helsida%' OR "name" LIKE 'Tekstannonce%'
       OR "name" IN ('Helsida (print display)', 'Baksida (print display)',
                     '1/1 helside (magasin)', 'Print 1/1-sida'));

-- ============ KORREKSJONER AV v2 (PLATFORM -> ADVERTISER) ============
SELECT _seed_inc('cafe-se', 'Native (färdig text)', '{"production": "ADVERTISER", "readsTotal": 5000, "durationWeeks": 2}');
SELECT _seed_inc('king-magazine-se', 'Native (färdig text)', '{"production": "ADVERTISER", "readsTotal": 5000, "durationWeeks": 2}');
SELECT _seed_inc('sa-gat-no', 'Native artikkel / video-native (per uke)', '{"production": "ADVERTISER", "durationWeeks": 1, "video": true}');
SELECT _seed_inc('folkemusikk-no', 'Content/native helside', '{"production": "ADVERTISER", "print": true}');

-- ============ ENKELTRADER (kuratert per kilde) ============
SELECT _seed_inc('aksess-no', 'Native article', '{"print": true}');
SELECT _seed_inc('aktuell-ha-llbarhet-se', 'Native article', '{"durationWeeks": 1}');
SELECT _seed_inc('byggindustrin-se', 'Native article', '{"durationWeeks": 1}');
SELECT _seed_inc('onkologi-i-sverige-se', 'Native article', '{"durationWeeks": 1}');
SELECT _seed_inc('allt-om-jakt-vapen-se', 'Nativeannons helsida (1 st)', '{"print": true}');
SELECT _seed_inc('allt-om-jakt-vapen-se', 'Nativeannons helsida (2+ st, per st)', '{"print": true, "articles": 2}');
SELECT _seed_inc('allt-om-jakt-vapen-se', 'Banner nyhetsbrev 564x140 (4 veckor)', '{"newsletter": true, "durationWeeks": 4}');
SELECT _seed_inc('allt-om-jakt-vapen-se', 'Filmsponsor – Jaktresan (per avsnitt)', '{"video": true}');
SELECT _seed_inc('allt-om-jakt-vapen-se', 'Livesändning mästerskap – Älghunds-SM huvudsponsor', '{"video": true}');
SELECT _seed_inc('allt-om-jakt-vapen-se', 'Jägarstudion – Logosponsor (helårsbokning/avsnitt)', '{"video": true}');
SELECT _seed_inc('allt-om-jakt-vapen-se', 'Jägarstudion – Produktpresentation (per avsnitt)', '{"video": true}');
SELECT _seed_inc('allt-om-jakt-vapen-se', 'Jägarstudion – Studiogäst (per avsnitt)', '{"video": true}');
SELECT _seed_inc('altinget-dk', 'Native opsætning', '{"production": "ADVERTISER", "newsletter": true}');
SELECT _seed_inc('altinget-dk', 'Native pr. læsning', '{"production": "ADVERTISER", "newsletter": true}');
SELECT _seed_inc('altinget-dk', 'Native eksempel (opsætning + 2 000 læsninger)', '{"production": "ADVERTISER", "newsletter": true, "readsTotal": 2000}');
SELECT _seed_inc('anleggsmaskinen-no', 'Annonsørinnhold kun print 1/1 (Anleggsmaskinen)', '{"print": true}');
SELECT _seed_inc('anleggsmaskinen-no', 'Native article', '{"print": true, "newsletter": true, "social": true}');
SELECT _seed_inc('arbetet-se', 'Native article', '{"print": true}');
SELECT _seed_inc('arbetet-se', 'Uppslag native (Arbetet)', '{"print": true}');
SELECT _seed_inc('arkitektur-no', 'Native article', '{"durationWeeks": 2}');
SELECT _seed_inc('arkitektur-no', 'Nyhetsbrev content/native (Arkitektur)', '{"newsletter": true}');
SELECT _seed_inc('ba-tliv-se', 'Nyhetsbrev advertorial (Båtliv SE)', '{"newsletter": true}');
SELECT _seed_inc('bondebladet-no', 'Native article', '{"durationWeeks": 1}');
SELECT _seed_inc('norsk-landbruk-no', 'Native article', '{"durationWeeks": 1}');
SELECT _seed_inc('buffe-se', 'Native-pakke (helside + foto + Instagram)', '{"production": "PUBLISHER", "print": true, "photographer": true, "socialChannels": ["Instagram"]}');
SELECT _seed_inc('bygg-no-no', 'Native article', '{"durationWeeks": 1}');
SELECT _seed_inc('camping-husvagn-se', 'Native artikel (ferdig levert)', '{"production": "ADVERTISER", "readsTotal": 5000}');
SELECT _seed_inc('camping-husvagn-se', 'Native artikel (redaksjonen skriver)', '{"production": "PUBLISHER", "readsTotal": 5000}');
SELECT _seed_inc('dagens-medisin-no', 'Nyhetsbrev-plassering HCP', '{"newsletter": true}');
SELECT _seed_inc('dagens-medisin-no', 'Webinar-produksjonspakke', '{"production": "PUBLISHER", "video": true}');
SELECT _seed_inc('dagens-medisin-no', 'Print helside (Dagens Medisin)', '{"print": true}');
SELECT _seed_inc('dagens-perspektiv', 'Annonsørinnhold – kun publisering (annonsørinnhold-side)', '{"production": "ADVERTISER", "searchableMonths": 24}');
SELECT _seed_inc('dagens-perspektiv', 'Native article', '{"production": "ADVERTISER", "frontpage": true, "newsletter": true, "durationWeeks": 2}');
SELECT _seed_inc('friluftsliv-no', 'Annonsørinnhold – kun publisering (annonsørinnhold-side)', '{"production": "ADVERTISER", "searchableMonths": 24}');
SELECT _seed_inc('friluftsliv-no', 'Native article', '{"production": "ADVERTISER", "frontpage": true, "newsletter": true, "durationWeeks": 2}');
SELECT _seed_inc('samtiden-no', 'Annonsørinnhold – kun publisering (annonsørinnhold-side)', '{"production": "ADVERTISER", "searchableMonths": 24}');
SELECT _seed_inc('samtiden-no', 'Native article', '{"production": "ADVERTISER", "frontpage": true, "newsletter": true, "durationWeeks": 2}');
SELECT _seed_inc('reiseliv1-no', 'Annonsørinnhold – kun publisering (annonsørinnhold-side)', '{"production": "ADVERTISER", "searchableMonths": 24}');
SELECT _seed_inc('reiseliv1-no', 'Native article', '{"production": "ADVERTISER", "frontpage": true, "newsletter": true, "durationWeeks": 2}');
SELECT _seed_inc('digi-no-no', 'Basic native (2 uker forside) – Digi.no', '{"frontpage": true, "durationWeeks": 2}');
SELECT _seed_inc('digi-no-no', 'Premium native (pr. uke) – Digi.no', '{"frontpage": true, "newsletter": true, "durationWeeks": 1}');
SELECT _seed_inc('digi-no-no', 'Brand Story (årsavtale) – Digi.no', '{"sovPct": 20, "searchableMonths": 12}');
SELECT _seed_inc('tu-no', 'Basic native (2 uker forside) – TU.no', '{"frontpage": true, "durationWeeks": 2}');
SELECT _seed_inc('tu-no', 'Premium native (pr. uke) – TU.no', '{"frontpage": true, "newsletter": true, "durationWeeks": 1}');
SELECT _seed_inc('tu-no', 'Brand Story (årsavtale) – TU.no', '{"sovPct": 20, "searchableMonths": 12}');
SELECT _seed_inc('e24-no', 'E24 Dag Front 100% SOV (ukedag)', '{"frontpage": true, "sovPct": 100}');
SELECT _seed_inc('vg-helg-no', 'VG Front 10% SOV', '{"frontpage": true, "sovPct": 10}');
SELECT _seed_inc('vg-helg-no', 'VG Helg 2 sider (print)', '{"print": true}');
SELECT _seed_inc('vg-helg-no', 'VG Helg Printstory 7 sider', '{"print": true}');
SELECT _seed_inc('fjell-og-vidde-no', '2/1 oppslag print (Fjell & Vidde)', '{"print": true}');
SELECT _seed_inc('fjell-og-vidde-no', 'Native article', '{"print": true}');
SELECT _seed_inc('fotografi-no', 'Native article', '{"print": true}');
SELECT _seed_inc('gartner-tidende-dk', 'Native helside (185x260, højreside)', '{"print": true}');
SELECT _seed_inc('gartner-tidende-dk', 'Native opslag (2 helsider)', '{"print": true}');
SELECT _seed_inc('gartneryrket-no', 'Native article', '{"frontpage": true, "durationWeeks": 4}');
SELECT _seed_inc('park-anlegg-no', 'Native article', '{"frontpage": true, "durationWeeks": 4}');
SELECT _seed_inc('g-r-det-selv-dk', 'Native (5 000 læsninger, øvrige brands)', '{"production": "PUBLISHER", "readsTotal": 5000, "social": true}');
SELECT _seed_inc('fysioterapi-se', 'Native helsida', '{"print": true}');
SELECT _seed_inc('hem-hyra-se', 'Native helsida', '{"print": true}');
SELECT _seed_inc('hippson-se', 'Native article', '{"socialChannels": ["Facebook", "Instagram"], "newsletter": true}');
SELECT _seed_inc('hus-hem-se', 'Native artikel (per sajt)', '{"production": "PUBLISHER"}');
SELECT _seed_inc('kampanje-no', 'Branded Stories – 4 artikler (Kampanje)', '{"articles": 4, "durationWeeks": 2}');
SELECT _seed_inc('king-se', 'Native article', '{"production": "PUBLISHER", "readsTotal": 5000}');
SELECT _seed_inc('king-se', 'Native – ferdig tekst (King Magazine)', '{"production": "ADVERTISER", "readsTotal": 5000}');
SELECT _seed_inc('kommunalarbetaren-se', 'Native article', '{"print": true}');
SELECT _seed_inc('maritimt-magasin-no', 'Native article', '{"print": true}');
SELECT _seed_inc('neurologi-i-sverige-se', 'Native article', '{"durationWeeks": 1}');
SELECT _seed_inc('pa-kryss-se', 'Native article', '{"newsletter": true}');
SELECT _seed_inc('res-se', 'Native (RES.se, per vecka)', '{"durationWeeks": 1}');
SELECT _seed_inc('seil-magasinet-no', 'Native ad premium (Seil Magasinet)', '{"durationWeeks": 1}');
SELECT _seed_inc('seil-magasinet-no', 'Native ad regular (Seil Magasinet)', '{"durationWeeks": 1}');
SELECT _seed_inc('sermitsiaq-dk', 'Sponsoreret artikel (online)', '{"production": "PUBLISHER", "frontpage": true, "social": true, "durationWeeks": 1}');
SELECT _seed_inc('sermitsiaq-dk', 'Sponsoreret artikel (temaaviser)', '{"production": "PUBLISHER", "print": true, "translation": true}');
SELECT _seed_inc('socionomen-se', 'Native article', '{"durationWeeks": 2, "newsletter": true}');
SELECT _seed_inc('socionomen-se', 'Native digital (Socionomen)', '{"newsletter": true}');
SELECT _seed_inc('socionomen-se', 'Native print (Socionomen)', '{"print": true}');
SELECT _seed_inc('tidningen-akademikern-se', 'Native article', '{"durationWeeks": 2, "newsletter": true}');
SELECT _seed_inc('tidningen-akademikern-se', 'Native digital (Akademikern)', '{"newsletter": true}');
SELECT _seed_inc('tidningen-akademikern-se', 'Native print (Akademikern)', '{"print": true}');
SELECT _seed_inc('sthavet-no', 'Native-artikkel (Østhavet)', '{"durationWeeks": 1}');
SELECT _seed_inc('storfjordnytt-no', 'Native / annonsørinnhold (per uke)', '{"durationWeeks": 1}');
SELECT _seed_inc('va-rt-land-no', 'Advertorial-teaser på front (vl.no)', '{"frontpage": true, "sovPct": 100, "durationWeeks": 1}');
SELECT _seed_inc('va-rt-land-no', 'Native article', '{"print": true}');
SELECT _seed_inc('den-norske-tannlegeforenings-tidende-no', 'Annonsørinnhold / advertorial – helside (1/1) print', '{"production": "ADVERTISER", "print": true}');
SELECT _seed_inc('finansavisen-no', 'Premium native — SOV (per uke)', '{"durationWeeks": 1}');
SELECT _seed_inc('finansavisen-no', 'Studioproduksjon (videointervju + native-artikkel + distribusjon)', '{"production": "PUBLISHER", "frontpage": true, "rights": true, "viewsTotal": 3000, "video": true}');
SELECT _seed_inc('finansavisen-no', 'Event-pakke: Arendalsuka CEO/CFO 2026', '{"video": true, "frontpage": true}');
SELECT _seed_inc('finansavisen-no', 'Event-pakke: Norges mektigste kvinner 2026', '{"video": true, "frontpage": true}');

DROP FUNCTION _seed_inc(text, text, jsonb);
