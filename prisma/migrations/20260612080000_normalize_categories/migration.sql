-- Normalize Title.category: collapse LANGUAGE duplicates and raw import
-- slugs into one canonical ENGLISH value per concept. Display-side
-- localization (src/lib/taxonomy-i18n.ts localizeCategory) translates the
-- canonical value per locale, so the DB no longer needs to carry the same
-- concept in five languages ("Lokal"/"Paikallinen"/"Local").
--
-- Scope: exact-match single-concept values only. Composite values
-- ("Lokalavis/Oslo", "Bygg/VVS", "Landbruk riks", …) are information-
-- bearing and stay untouched. Covers every distinct value with count >= 5
-- at migration time plus obvious lower-frequency language/case duplicates
-- of the same concepts.

-- Geo / news tiers
UPDATE "Title" SET category = 'Local' WHERE category IN ('Lokal', 'Paikallinen', 'Lokalavis');
UPDATE "Title" SET category = 'Regional' WHERE category IN ('Alueellinen', 'regional-news');
UPDATE "Title" SET category = 'National' WHERE category IN ('Riks', 'Valtakunnallinen', 'Valtak.');
UPDATE "Title" SET category = 'International' WHERE category IN ('Internasjonal', 'Kansainvälinen');
UPDATE "Title" SET category = 'Regional (Swedish-language)' WHERE category IN ('Alueellinen (ruots.)');
UPDATE "Title" SET category = 'Local (Swedish-language)' WHERE category IN ('Paikallinen (ruots.)');
UPDATE "Title" SET category = 'General news' WHERE category IN ('general-news');
UPDATE "Title" SET category = 'Current affairs' WHERE category IN ('current-affairs', 'Aktualitet');

-- Topics
UPDATE "Title" SET category = 'Health' WHERE category IN ('Helse', 'Terveys', 'Sundhed', 'health');
UPDATE "Title" SET category = 'Law' WHERE category IN ('Juss', 'Legal', 'Oikeus');
UPDATE "Title" SET category = 'Food' WHERE category IN ('Mat', 'Ruoka', 'food');
UPDATE "Title" SET category = 'Auto' WHERE category IN ('Bil', 'Cars', 'Car', 'Motor', 'motoring');
UPDATE "Title" SET category = 'Agriculture' WHERE category IN ('Landbruk', 'Farming', 'Landbrug', 'Maatalous');
UPDATE "Title" SET category = 'Home & interior' WHERE category IN ('Bolig', 'Home/interior', 'Interiør');
UPDATE "Title" SET category = 'Music' WHERE category IN ('Musikk', 'Musiikki', 'music');
UPDATE "Title" SET category = 'Literature' WHERE category IN ('Litteratur', 'Kirjallisuus');
UPDATE "Title" SET category = 'History' WHERE category IN ('Historie');
UPDATE "Title" SET category = 'Science' WHERE category IN ('Vitenskap', 'Tiede');
UPDATE "Title" SET category = 'Politics' WHERE category IN ('Politikk', 'Politiikka', 'Politik');
UPDATE "Title" SET category = 'Trade union' WHERE category IN ('Fagforening', 'Ammattiliitto');
UPDATE "Title" SET category = 'Christian' WHERE category IN ('Kristen');
UPDATE "Title" SET category = 'Religion' WHERE category IN ('Uskonto');
UPDATE "Title" SET category = 'Student newspaper' WHERE category IN ('Studentavis');
UPDATE "Title" SET category = 'Student magazine' WHERE category IN ('Studentmagasin');
UPDATE "Title" SET category = 'Construction' WHERE category IN ('Bygg', 'Rakentaminen', 'Bygge');
UPDATE "Title" SET category = 'Civil engineering' WHERE category IN ('Anlegg');
UPDATE "Title" SET category = 'Medicine' WHERE category IN ('Medisin', 'Medical', 'Medicin', 'Lääketiede');
UPDATE "Title" SET category = 'Family' WHERE category IN ('Familie');
UPDATE "Title" SET category = 'Energy' WHERE category IN ('Energi');
UPDATE "Title" SET category = 'Defence' WHERE category IN ('Forsvar', 'Puolustus', 'Defense');
UPDATE "Title" SET category = 'Travel' WHERE category IN ('Reise', 'Rejse', 'Matka', 'travel');
UPDATE "Title" SET category = 'Maritime' WHERE category IN ('Maritim');
UPDATE "Title" SET category = 'Equestrian' WHERE category IN ('Hest', 'Horses', 'Ridning');
UPDATE "Title" SET category = 'Technology' WHERE category IN ('Tech', 'Teknologi', 'Tekniikka');
UPDATE "Title" SET category = 'Boating' WHERE category IN ('Båt', 'Veneily');
UPDATE "Title" SET category = 'Animals' WHERE category IN ('Dyr');
UPDATE "Title" SET category = 'Management' WHERE category IN ('Ledelse');
UPDATE "Title" SET category = 'Children' WHERE category IN ('Lapset', 'Børn', 'Children''s', 'Barn', 'Kids');
UPDATE "Title" SET category = 'School' WHERE category IN ('Skole');
UPDATE "Title" SET category = 'Education' WHERE category IN ('Utdanning', 'Uddannelse', 'Opetus');
UPDATE "Title" SET category = 'Pedagogy' WHERE category IN ('Pedagogikk', 'Pædagogik');
UPDATE "Title" SET category = 'Celebrity' WHERE category IN ('celebrity', 'Kjendis');
UPDATE "Title" SET category = 'Comics' WHERE category IN ('Tegneserie', 'Sarjakuva');
UPDATE "Title" SET category = 'Research' WHERE category IN ('Forskning');
UPDATE "Title" SET category = 'Women''s lifestyle' WHERE category IN ('Kvinne/livsstil', 'Kvinde/livsstil', 'Nainen/elämäntapa', 'women', 'Women''s');
UPDATE "Title" SET category = 'Garden' WHERE category IN ('Hage', 'Gardening');
UPDATE "Title" SET category = 'Local history' WHERE category IN ('Lokalhistorie');
UPDATE "Title" SET category = 'Business' WHERE category IN ('Erhverv', 'business', 'Näringsliv', 'Liiketoiminta');
UPDATE "Title" SET category = 'Sport' WHERE category IN ('Idrett', 'Sports', 'sport', 'Urheilu');
UPDATE "Title" SET category = 'Photography' WHERE category IN ('Foto');
UPDATE "Title" SET category = 'TV & film' WHERE category IN ('tv-film');
UPDATE "Title" SET category = 'Dogs' WHERE category IN ('Hund');
UPDATE "Title" SET category = 'Architecture' WHERE category IN ('Arkitektur');
UPDATE "Title" SET category = 'Entertainment' WHERE category IN ('entertainment', 'Underholdning', 'Underhållning');
UPDATE "Title" SET category = 'Art' WHERE category IN ('Kunst');
UPDATE "Title" SET category = 'Hospitality' WHERE category IN ('Horeca');
UPDATE "Title" SET category = 'Street magazine' WHERE category IN ('Gatemagasin');
UPDATE "Title" SET category = 'Outdoor life' WHERE category IN ('Friluftsliv', 'Ulkoilu');
UPDATE "Title" SET category = 'Police' WHERE category IN ('Politi', 'Poliisi');
UPDATE "Title" SET category = 'Fashion' WHERE category IN ('Mote', 'Mode', 'Muoti', 'fashion');
UPDATE "Title" SET category = 'Football' WHERE category IN ('Fotball', 'Jalkapallo');
UPDATE "Title" SET category = 'Academics' WHERE category IN ('Akademiker');
UPDATE "Title" SET category = 'Economy' WHERE category IN ('Økonomi', 'Talous');
UPDATE "Title" SET category = 'Lifestyle' WHERE category IN ('Livsstil', 'lifestyle');
UPDATE "Title" SET category = 'Industry' WHERE category IN ('Industri');
UPDATE "Title" SET category = 'HVAC & plumbing' WHERE category IN ('VVS', 'LVI');
UPDATE "Title" SET category = 'Fisheries' WHERE category IN ('Fiskeri');
UPDATE "Title" SET category = 'Philosophy' WHERE category IN ('Filosofi');
UPDATE "Title" SET category = 'Culture' WHERE category IN ('Kultur', 'Kulttuuri', 'culture');
UPDATE "Title" SET category = 'Dentistry' WHERE category IN ('Tannlege', 'Tandlæge', 'Hammaslääketiede');
UPDATE "Title" SET category = 'Cycling' WHERE category IN ('Sykling', 'Cykling');
UPDATE "Title" SET category = 'Nature' WHERE category IN ('Luonto');
UPDATE "Title" SET category = 'Finance' WHERE category IN ('Finans', 'finance');
UPDATE "Title" SET category = 'Marketing' WHERE category IN ('Markkinointi', 'Marknadsföring');
UPDATE "Title" SET category = 'Pharmacy' WHERE category IN ('Farmasi', 'Farmaci', 'Farmasia');
UPDATE "Title" SET category = 'Nursing' WHERE category IN ('Sykepleie', 'Sygepleje', 'Sairaanhoito');
UPDATE "Title" SET category = 'Film' WHERE category IN ('Elokuva');
UPDATE "Title" SET category = 'Hunting' WHERE category IN ('Jakt');
UPDATE "Title" SET category = 'Forestry' WHERE category IN ('Skogbruk', 'Metsätalous', 'Skog');
UPDATE "Title" SET category = 'Insurance' WHERE category IN ('Vakuutus');
UPDATE "Title" SET category = 'Retail' WHERE category IN ('Detaljhandel', 'Detailhandel');
UPDATE "Title" SET category = 'Journalism' WHERE category IN ('Journalismi');
UPDATE "Title" SET category = 'Psychology' WHERE category IN ('Psykologi');
UPDATE "Title" SET category = 'Environment' WHERE category IN ('Miljø', 'Ympäristö');
UPDATE "Title" SET category = 'Wine' WHERE category IN ('Vin', 'Viini');
UPDATE "Title" SET category = 'Parenting' WHERE category IN ('Foreldre', 'Forældre');
UPDATE "Title" SET category = 'Youth' WHERE category IN ('Ungdom', 'Nuoret');
UPDATE "Title" SET category = 'Motorcycle' WHERE category IN ('Moottoripyörä', 'MC');
UPDATE "Title" SET category = 'Classic cars' WHERE category IN ('Veteranbil');
