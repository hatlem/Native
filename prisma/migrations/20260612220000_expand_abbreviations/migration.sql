-- Abbreviation publishers: recognizable full name first, alias in
-- parens (user convention: "Financial Times (FT)"). Only unambiguous
-- single-org rows renamed. Rows holding titles from DIFFERENT orgs
-- (SLL, SHL, MF, KL, SSL, SAL, BM, H&M, LM) are data bugs -> desk-
-- flagged for splitting, not renamed. Brand-name abbreviations that
-- ARE the name (3F, SEGES, ETC, EMAP, FDM, NHO) kept as-is.

UPDATE "Publisher" SET name='Financial Times (FT)'            WHERE name='FT'  AND "countryCode"='UK';
UPDATE "Publisher" SET name='Total Politics (TP)'             WHERE name='TP'  AND "countryCode"='UK';
UPDATE "Publisher" SET name='Midland News Association (MNA)'  WHERE name='MNA' AND "countryCode"='UK';
UPDATE "Publisher" SET name='DVV Media International (DVV)'   WHERE name='DVV' AND "countryCode"='UK';
UPDATE "Publisher" SET name='Civil Society Media (CSM)'       WHERE name='CSM' AND "countryCode"='UK';
UPDATE "Publisher" SET name='Research Professional (RP)'      WHERE name='RP'  AND "countryCode"='UK';
UPDATE "Publisher" SET name='Cappelen Damm Akademisk (CDA)'   WHERE name='CDA' AND "countryCode"='NO';
UPDATE "Publisher" SET name='Den Norske Turistforening (DNT)' WHERE name='DNT' AND "countryCode"='NO';
UPDATE "Publisher" SET name='Byggenæringens Landsforening (BNL)' WHERE name='BNL' AND "countryCode"='NO';
UPDATE "Publisher" SET name='University College Dublin (UCD)' WHERE name='UCD' AND "countryCode"='IE';
UPDATE "Publisher" SET name='Akademikerförbundet SSR'         WHERE name='SSR' AND "countryCode"='SE';
UPDATE "Publisher" SET name='IDG (International Data Group)'  WHERE name='IDG' AND "countryCode"='SE';
UPDATE "Publisher" SET name='Dansk Industri (DI)'             WHERE name='DI'  AND "countryCode"='DK';

-- MA (UK) er Mark Allen Group — fold inn i eksisterende husrad.
DO $mig$
DECLARE mag_id text; ma_id text; fk record; row_id text;
BEGIN
  SELECT id INTO mag_id FROM "Publisher" WHERE "countryCode"='UK' AND name='Mark Allen Group (UK)';
  SELECT id INTO ma_id  FROM "Publisher" WHERE "countryCode"='UK' AND name='MA';
  IF mag_id IS NULL OR ma_id IS NULL THEN RETURN; END IF;
  FOR fk IN
    SELECT tc.table_name AS tbl, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
    WHERE tc.constraint_type='FOREIGN KEY'
      AND ccu.table_name='Publisher' AND ccu.column_name='id' AND tc.table_schema='public'
  LOOP
    FOR row_id IN EXECUTE format('SELECT id FROM %I WHERE %I=$1', fk.tbl, fk.col) USING ma_id
    LOOP
      BEGIN
        EXECUTE format('UPDATE %I SET %I=$1 WHERE id=$2', fk.tbl, fk.col) USING mag_id, row_id;
      EXCEPTION WHEN unique_violation THEN
        EXECUTE format('DELETE FROM %I WHERE id=$1', fk.tbl) USING row_id;
      END;
    END LOOP;
  END LOOP;
  DELETE FROM "Publisher" WHERE id=ma_id;
END $mig$;

-- Blandingsrader: titler fra ulike organisasjoner deler én utgiver-rad.
UPDATE "Title" SET "outstandingInfo" = array_append("outstandingInfo",
  'Utgiver-rad delt mellom ulike organisasjoner (forkortelseskollisjon) — desk må splitte i egne utgivere')
WHERE "publisherId" IN (
  SELECT id FROM "Publisher"
  WHERE (name,'') IN (VALUES ('SLL',''),('SHL',''),('MF',''),('KL',''),
                             ('SSL',''),('SAL',''),('BM',''),('H&M',''),('LM',''))
)
AND NOT ('Utgiver-rad delt mellom ulike organisasjoner (forkortelseskollisjon) — desk må splitte i egne utgivere' = ANY("outstandingInfo"));
