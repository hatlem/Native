-- Abbreviation-publisher reconciliation (user convention: "Full Name (ABBR) (CC)").
-- Only verified expansions — abbreviations that ARE the official name
-- (FOA->full form, OAJ, PAM, JHL, TEK, SEGES, BMJ, ADAC, EMAP, ETC, ICA, ...)
-- keep or get their official long form. Uncertain rows are left untouched.

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION _ren(p_old text, p_new text) RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Publisher" WHERE name = p_new) THEN
    RAISE NOTICE 'skip rename % -> % (target exists)', p_old, p_new;
    RETURN;
  END IF;
  UPDATE "Publisher" SET name = p_new, "updatedAt" = now() WHERE name = p_old;
END $$ LANGUAGE plpgsql;

-- Merge src publisher into dst: repoint every FK column referencing
-- Publisher.id, then delete the emptied src row.
CREATE OR REPLACE FUNCTION _merge_pub(p_src text, p_dst text) RETURNS void AS $$
DECLARE src_id text; dst_id text; r record;
BEGIN
  SELECT id INTO src_id FROM "Publisher" WHERE name = p_src;
  SELECT id INTO dst_id FROM "Publisher" WHERE name = p_dst;
  IF src_id IS NULL OR dst_id IS NULL THEN
    RAISE NOTICE 'skip merge % -> % (missing row)', p_src, p_dst;
    RETURN;
  END IF;
  FOR r IN
    SELECT tc.table_name AS tbl, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'Publisher' AND ccu.column_name = 'id'
      AND tc.table_schema = 'public'
  LOOP
    EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', r.tbl, r.col, r.col)
      USING dst_id, src_id;
  END LOOP;
  DELETE FROM "Publisher" WHERE id = src_id;
END $$ LANGUAGE plpgsql;

-- Move one title (by slug) to a publisher row created on demand in the
-- title's own country (split helper, same as the 0612 collision split).
CREATE OR REPLACE FUNCTION _to_pub2(p_slug text, p_pubname text) RETURNS void AS $$
DECLARE pid text; t record;
BEGIN
  SELECT id, "countryCode", "marketId" INTO t FROM "Title" WHERE slug = p_slug;
  IF t.id IS NULL THEN RAISE NOTICE 'skip %, no title', p_slug; RETURN; END IF;
  SELECT id INTO pid FROM "Publisher" WHERE name = p_pubname;
  IF pid IS NULL THEN
    INSERT INTO "Publisher" (id, name, "countryCode", "marketId", "pricesPublic", "createdAt", "updatedAt")
    VALUES ('pub_' || md5(p_pubname), p_pubname, t."countryCode", t."marketId", true, now(), now())
    RETURNING id INTO pid;
  END IF;
  UPDATE "Title" SET "publisherId" = pid, "updatedAt" = now() WHERE id = t.id;
END $$ LANGUAGE plpgsql;

-- ---------- NO ----------
SELECT _ren('NAL (NO)',  'Norske arkitekters landsforbund (NAL) (NO)');
SELECT _ren('NMS (NO)',  'Det Norske Misjonsselskap (NMS) (NO)');
SELECT _ren('NAAF (NO)', 'Norges Astma- og Allergiforbund (NAAF) (NO)');
SELECT _ren('MEF (NO)',  'Maskinentreprenørenes Forbund (MEF) (NO)');
SELECT _ren('NKK (NO)',  'Norsk Kennel Klub (NKK) (NO)');
SELECT _ren('NAF (NO)',  'Norges Automobil-Forbund (NAF) (NO)');
SELECT _ren('DNT (NO)',  'Den Norske Turistforening (DNT) (NO)');
SELECT _ren('HLF (NO)',  'Hørselshemmedes Landsforbund (HLF) (NO)');
SELECT _ren('FIVH (NO)', 'Framtiden i våre hender (FIVH) (NO)');
SELECT _ren('NBBL (NO)', 'Norske Boligbyggelags Landsforbund (NBBL) (NO)');
SELECT _ren('NSG (NO)',  'Norsk Sau og Geit (NSG) (NO)');
SELECT _ren('NGF (NO)',  'Norges Golfforbund (NGF) (NO)');
SELECT _ren('NIF (NO)',  'Norges idrettsforbund (NIF) (NO)');
SELECT _ren('BFO (NO)',  'Befalets Fellesorganisasjon (BFO) (NO)');
SELECT _ren('YTF (NO)',  'Yrkestrafikkforbundet (YTF) (NO)');
SELECT _ren('FO (NO)',   'Fellesorganisasjonen (FO) (NO)');
SELECT _ren('HK (NO)',   'Handel og Kontor i Norge (HK) (NO)');
SELECT _ren('NTF (NO)',  'Den norske tannlegeforening (NTF) (NO)');
SELECT _ren('NFVB (NO)', 'Norske frisør- og velværebedrifter (NFVB) (NO)');
SELECT _ren('KLF (NO)',  'Kjøtt- og fjørfebransjens Landsforbund (KLF) (NO)');
SELECT _ren('NCC (NO)',  'Norsk Caravan Club (NCC) (NO)');
SELECT _ren('NFFO (NO)', 'Norsk faglitterær forfatter- og oversetterforening (NFFO) (NO)');
SELECT _ren('DNFO (NO)', 'Den Norske Frimurerorden (DNFO) (NO)');
SELECT _ren('BHF (NO)',  'Bergens historiske forening (BHF) (NO)');
SELECT _ren('NVHS (NO)', 'Norsk Veterinærhistorisk Selskap (NVHS) (NO)');
SELECT _ren('NSFLOS (NO)', 'NSFs Landsgruppe av Operasjonssykepleiere (NSFLOS) (NO)');
SELECT _ren('CDA (NO)',  'Cappelen Damm Akademisk (CDA) (NO)');
SELECT _ren('SVV (NO)',  'Statens vegvesen (SVV) (NO)');
SELECT _ren('MFO (NO)',  'Creo (tidl. MFO) (NO)');

-- ---------- DK ----------
SELECT _ren('DSR (DK)',  'Dansk Sygeplejeråd (DSR) (DK)');
SELECT _ren('DLF (DK)',  'Danmarks Lærerforening (DLF) (DK)');
SELECT _ren('FH (DK)',   'Fagbevægelsens Hovedorganisation (FH) (DK)');
SELECT _ren('GL (DK)',   'Gymnasieskolernes Lærerforening (GL) (DK)');
SELECT _ren('DDD (DK)',  'Den Danske Dyrlægeforening (DDD) (DK)');
SELECT _ren('DJ (DK)',   'Dansk Journalistforbund (DJ) (DK)');
SELECT _ren('DJF (DK)',  'Danmarks Jægerforbund (DJF) (DK)');
SELECT _ren('DIF (DK)',  'Danmarks Idrætsforbund (DIF) (DK)');
SELECT _ren('DSF (DK)',  'Dansk Skovforening (DSF) (DK)');
SELECT _ren('DS (DK)',   'Dansk Sejlunion (DS) (DK)');
SELECT _ren('DTL (DK)',  'DTL – Danske Vognmænd (DK)');
SELECT _ren('DI (DK)',   'Dansk Industri (DI) (DK)');
SELECT _ren('EFD (DK)',  'EjendomDanmark (DK)');
SELECT _ren('JMF (DK)',  'Jordemoderforeningen (DK)');
SELECT _ren('MMF (DK)',  'Maskinmestrenes Forening (MMF) (DK)');
SELECT _ren('KF (DK)',   'Konstruktørforeningen (KF) (DK)');
SELECT _ren('DDP (DK)',  'Præsteforeningen (DK)');
SELECT _ren('UF (DK)',   'Uddannelsesforbundet (DK)');
SELECT _ren('DEF (DK)',  'Dansk El-Forbund (DEF) (DK)');
SELECT _ren('HK (DK)',   'HK Danmark (DK)');
SELECT _ren('FDM (DK)',  'FDM – Forenede Danske Motorejere (DK)');
SELECT _ren('AC (DK)',   'Akademikerne (AC) (DK)');
SELECT _ren('BL (DK)',   'BL – Danmarks Almene Boliger (DK)');
SELECT _ren('AAF (DK)',  'Arkitektforeningen (AAF) (DK)');
SELECT _ren('TEKNIQ (DK)', 'TEKNIQ Arbejdsgiverne (DK)');
SELECT _ren('DJØF (DK)', 'Djøf (DK)');
SELECT _ren('BT (DK)',   'Bornholms Tidende AS (DK)');
SELECT _ren('FOA (DK)',  'FOA – Fag og Arbejde (DK)');
SELECT _ren('BUPL (DK)', 'BUPL – Børne- og Ungdomspædagogernes Landsforbund (DK)');
SELECT _ren('HJV (DK)',  'Hjemmeværnet (HJV) (DK)');

-- ---------- SE ----------
SELECT _ren('LRF (SE)',  'LRF Media (SE)');
SELECT _ren('SKR (SE)',  'Sveriges Kommuner och Regioner (SKR) (SE)');
SELECT _ren('SKK (SE)',  'Svenska Kennelklubben (SKK) (SE)');
SELECT _ren('SAC (SE)',  'SAC Syndikalisterna (SE)');
SELECT _ren('SEF (SE)',  'Svenska Elektrikerförbundet (SEF) (SE)');
SELECT _ren('SSR (SE)',  'Akademikerförbundet SSR (SE)');
SELECT _ren('SPF (SE)',  'SPF Seniorerna (SE)');
SELECT _ren('SKPF (SE)', 'SKPF Pensionärerna (SE)');
SELECT _ren('F&F (SE)',  'Forskning & Framsteg (F&F) (SE)');
SELECT _ren('VR (SE)',   'Vetenskapsrådet (VR) (SE)');
SELECT _ren('RF (SE)',   'Riksidrottsförbundet (RF) (SE)');
SELECT _ren('SFAM (SE)', 'Svensk förening för allmänmedicin (SFAM) (SE)');
SELECT _ren('PSF (SE)',  'Sveriges Psykologförbund (SE)');
SELECT _ren('STF (SE)',  'Sveriges Tandläkarförbund (SE)');
SELECT _ren('SULF (SE)', 'SULF – Sveriges universitetslärare och forskare (SE)');
SELECT _ren('PRO (SE)',  'PRO – Pensionärernas Riksorganisation (SE)');
SELECT _ren('NTM (SE)',  'NTM-koncernen (SE)');
SELECT _ren('KP (SE)',   'Kommunistiska Partiet (KP) (SE)');
SELECT _ren('VK (SE)',   'VK Media (SE)');

-- ---------- FI ----------
SELECT _ren('MLL (FI)',  'Mannerheimin Lastensuojeluliitto (MLL) (FI)');
SELECT _ren('SELL (FI)', 'Suomen Eläinlääkäriliitto (SELL) (FI)');
SELECT _ren('EKL (FI)',  'Eläkkeensaajien Keskusliitto (EKL) (FI)');
SELECT _ren('SPAL (FI)', 'Suomen pelastusalan ammattilaiset (SPAL) (FI)');
SELECT _ren('SPJL (FI)', 'Suomen Poliisijärjestöjen Liitto (SPJL) (FI)');
SELECT _ren('SY (FI)',   'Suomen Yrittäjät (SY) (FI)');
SELECT _ren('TSV (FI)',  'Tieteellisten seurain valtuuskunta (TSV) (FI)');
SELECT _ren('RES (FI)',  'Reserviläisliitto (RES) (FI)');
SELECT _ren('ÅU (FI)',   'Förlags Ab Sydvästkusten (ÅU) (FI)');
SELECT _ren('SBL (FI)',  'Suomen Bioanalyytikkoliitto (SBL) (FI)');
SELECT _ren('SFI (FI)',  'Suomen Fysioterapeutit (FI)');
SELECT _ren('YM (FI)',   'Ympäristöministeriö (YM) (FI)');
SELECT _ren('PV (FI)',   'Puolustusvoimat (PV) (FI)');

-- ---------- UK / IE / DE ----------
SELECT _ren('THE (UK)',  'Times Higher Education (THE) (UK)');
SELECT _ren('LRB (UK)',  'London Review of Books (LRB) (UK)');
SELECT _ren('RPS (UK)',  'Royal Pharmaceutical Society (RPS) (UK)');
SELECT _ren('ICE (UK)',  'Institution of Civil Engineers (ICE) (UK)');
SELECT _ren('NFU (UK)',  'National Farmers'' Union (NFU) (UK)');
SELECT _ren('PA (UK)',   'PA Media Group (UK)');
SELECT _ren('MNA (UK)',  'Midland News Association (MNA) (UK)');
SELECT _ren('DVV (UK)',  'DVV Media Group (UK)');
SELECT _ren('AMG (UK)',  'Asian Media Group (AMG) (UK)');
SELECT _ren('CSM (UK)',  'Civil Society Media (UK)');
SELECT _ren('NS (UK)',   'New Statesman Media Group (NS) (UK)');
SELECT _ren('SJP (UK)',  'SJP Business Media (UK)');
SELECT _ren('TTG (UK)',  'TTG Media (UK)');
SELECT _ren('INMO (IE)', 'Irish Nurses and Midwives Organisation (INMO) (IE)');
SELECT _ren('RIAI (IE)', 'Royal Institute of the Architects of Ireland (RIAI) (IE)');
SELECT _ren('GEW (DE)',  'Gewerkschaft Erziehung und Wissenschaft (GEW) (DE)');
SELECT _ren('DGAP (DE)', 'Deutsche Gesellschaft für Auswärtige Politik (DGAP) (DE)');

-- ---------- merges into existing correct rows ----------
SELECT _merge_pub('FT (UK)',  'Financial Times Ltd (UK)');   -- FT specials belong to the FT row
SELECT _merge_pub('VG (NO)',  'Schibsted (NO)');             -- VG-bilag under Schibsted (user ruling 06-11)
SELECT _merge_pub('T&V (NO)', 'Teknisk Ukeblad Media (NO)'); -- TU.no is TUM
SELECT _merge_pub('UBM (UK)', 'TTG Media (UK)');             -- TTG sold by UBM to TTG Media long ago
SELECT _merge_pub('AH (SE)',  'Bonnier News (SE)');          -- Aktuell Hållbarhet is Bonnier News
SELECT _merge_pub('VF (SE)',  'VK Media (SE)');              -- Västerbottens Folkblad published by VK Media

-- ---------- NBF (NO) collision split ----------
SELECT _to_pub2(t.slug, 'Norske Blikkenslagermesteres Landsforbund (NO)')
FROM "Title" t JOIN "Publisher" p ON p.id = t."publisherId"
WHERE p.name = 'NBF (NO)' AND t.name = 'Blikkenslageren';
SELECT _to_pub2(t.slug, 'Norsk brannvernforening (NO)')
FROM "Title" t JOIN "Publisher" p ON p.id = t."publisherId"
WHERE p.name = 'NBF (NO)' AND t.name = 'Brann og Sikkerhet';
DELETE FROM "Publisher" p WHERE p.name = 'NBF (NO)'
  AND NOT EXISTS (SELECT 1 FROM "Title" t WHERE t."publisherId" = p.id);

-- ---------- Børn & Unge duplicate (PM row vs BUPL row) ----------
UPDATE "Product" SET active = false, bookable = false, "updatedAt" = now()
WHERE "titleId" IN (
  SELECT t.id FROM "Title" t JOIN "Publisher" p ON p.id = t."publisherId"
  WHERE p.name = 'PM (DK)' AND t.name = 'Børn & Unge');
UPDATE "Title" SET active = false,
  "discontinuedNote" = 'Duplikat av Børn&Unge (BUPL) — slått sammen 2026-06-12',
  "updatedAt" = now()
WHERE id IN (
  SELECT t.id FROM "Title" t JOIN "Publisher" p ON p.id = t."publisherId"
  WHERE p.name = 'PM (DK)' AND t.name = 'Børn & Unge');
UPDATE "Title" SET aliases = array_append(aliases, 'Børn & Unge'), "updatedAt" = now()
WHERE name = 'Børn&Unge' AND NOT 'Børn & Unge' = ANY(aliases);
SELECT _merge_pub('PM (DK)', 'BUPL – Børne- og Ungdomspædagogernes Landsforbund (DK)');

-- ---------- HBL (SE) wrong-market duplicate ----------
UPDATE "Product" SET active = false, bookable = false, "updatedAt" = now()
WHERE "titleId" IN (
  SELECT t.id FROM "Title" t JOIN "Publisher" p ON p.id = t."publisherId"
  WHERE p.name = 'HBL (SE)' AND t.name = 'Hufvudstadsbladet');
UPDATE "Title" SET active = false,
  "discontinuedNote" = 'Duplikat i feil marked — HBL er finsk (hufvudstadsbladet-fi under KSF Media). 2026-06-12',
  "updatedAt" = now()
WHERE id IN (
  SELECT t.id FROM "Title" t JOIN "Publisher" p ON p.id = t."publisherId"
  WHERE p.name = 'HBL (SE)' AND t.name = 'Hufvudstadsbladet');

-- ---------- universities (NTNU precedent: org publications, not inventory) ----------
UPDATE "Product" SET active = false, bookable = false, "updatedAt" = now()
WHERE "titleId" IN (
  SELECT t.id FROM "Title" t JOIN "Publisher" p ON p.id = t."publisherId"
  WHERE p.name IN ('AU (DK)', 'DPU (DK)', 'NHH (NO)', 'UCD (IE)', 'UCC (IE)'));
UPDATE "Title" SET active = false,
  "discontinuedNote" = 'Fjernet 2026-06-12: universitetsutgivelse, ikke annonseinventar (NTNU-presedens)',
  "updatedAt" = now()
WHERE "publisherId" IN (
  SELECT id FROM "Publisher" WHERE name IN ('AU (DK)', 'DPU (DK)', 'NHH (NO)', 'UCD (IE)', 'UCC (IE)'));

DROP FUNCTION _ren(text, text);
DROP FUNCTION _merge_pub(text, text);
DROP FUNCTION _to_pub2(text, text);
