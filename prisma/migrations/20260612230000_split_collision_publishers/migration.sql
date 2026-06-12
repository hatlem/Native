-- Split the 9 abbreviation-collision publisher rows: each flagged title
-- moves to its real organisation (from ownerGroup evidence) or becomes
-- a standalone publisher. Surviving rows renamed to their single
-- remaining org per the full-name (alias) convention. Flags cleared.

CREATE OR REPLACE FUNCTION _to_pub(p_slug text, p_pubname text)
RETURNS void AS $fn$
DECLARE t_row record; pid text;
BEGIN
  SELECT id, "countryCode", "marketId" INTO t_row FROM "Title" WHERE slug = p_slug;
  IF t_row IS NULL THEN RETURN; END IF;
  SELECT id INTO pid FROM "Publisher"
    WHERE "countryCode" = t_row."countryCode" AND name = p_pubname LIMIT 1;
  IF pid IS NULL THEN
    INSERT INTO "Publisher"(id,name,"countryCode","marketId","pricesPublic","createdAt","updatedAt")
    VALUES ('pub_'||md5(t_row."countryCode"||p_pubname), p_pubname,
            t_row."countryCode", t_row."marketId", true, now(), now())
    RETURNING id INTO pid;
  END IF;
  UPDATE "Title" SET "publisherId" = pid,
    "outstandingInfo" = array_remove("outstandingInfo",
      'Utgiver-rad delt mellom ulike organisasjoner (forkortelseskollisjon) — desk må splitte i egne utgivere')
  WHERE id = t_row.id;
END; $fn$ LANGUAGE plpgsql;

-- FI: fagforbund hver for seg
SELECT _to_pub('lakimiesuutiset-fi',          'Suomen Lakimiesliitto');
SELECT _to_pub('suomen-luonto-fi',            'Suomen Luonnonsuojeluliitto');
SELECT _to_pub('suomen-la-a-ka-rilehti-fi',   'Suomen Lääkäriliitto');
SELECT _to_pub('hammasla-a-ka-rilehti-fi',    'Suomen Hammaslääkäriliitto');
SELECT _to_pub('sairaanhoitaja-fi',           'Sairaanhoitajaliitto');
SELECT _to_pub('syda-n-ha-meen-lehti-fi',     'Sydän-Hämeen Lehti');
SELECT _to_pub('apteekkari-fi',               'Suomen Apteekkariliitto');
SELECT _to_pub('defensor-legis-fi',           'Suomen Asianajajaliitto');
SELECT _to_pub('kuntalehti-fi',               'Kuntaliitto');
SELECT _to_pub('karjala-lehti-fi',            'Karjala-lehti');
SELECT _to_pub('suomen-sa-hko-alan-liitto-fi','Sähköliitto');
SELECT _to_pub('sisa-suomen-lehti-fi',        'Sisä-Suomen Lehti');

-- DK
SELECT _to_pub('kommunalbladet-dk',           'KL – Kommunernes Landsforening');
SELECT _to_pub('landbrugsavisen-dk',          'Landbrugsmedierne (LM)');
SELECT _to_pub('mark-dk',                     'Landbrugsmedierne (LM)');
SELECT _to_pub('lystfiskeri-magasinet-dk',    'Lystfiskeri Magasinet');
SELECT _to_pub('maler-dk',                    'Malernes Fagforening (MF)');
SELECT _to_pub('mors-folkeblad-dk',           'Morsø Folkeblad');
SELECT _to_pub('bil-magasinet-dk-dk',         'Bil Magasinet');
SELECT _to_pub('ba-dmagasinet-dk',            'Bådmagasinet');

-- SE
SELECT _to_pub('hifi-musik-se',               'Hifi & Musik');
SELECT _to_pub('hus-mark-se',                 'Hus & Mark');

DROP FUNCTION _to_pub(text, text);

-- Tomme kollisjonsrader slettes (alle FK-er er flyttet med titlene;
-- rene forkortelsesrader hadde ingen egne kontakter).
DELETE FROM "Publisher" p
WHERE p.name IN ('SLL','SHL','MF','KL','SSL','SAL','BM','H&M','LM')
  AND NOT EXISTS (SELECT 1 FROM "Title" t WHERE t."publisherId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "SalesContact" sc WHERE sc."publisherId" = p.id);

-- Norsk Fiskerinæring: korrekt URL, flagg fjernes.
UPDATE "Title" SET "websiteUrl" = 'https://norskfisk.no',
  "outstandingInfo" = array_remove("outstandingInfo",
    'websiteUrl peker på kystogfjord.no — feil for Norsk Fiskerinæring; verifiser riktig URL og eierskap')
WHERE slug = 'norsk-fiskerin-ring-no';
