-- Canonical publishers v2: systematic same-country duplicate sweep
-- (normalized-name + prefix-overlap scan over all rows). Same rules:
-- per country only, real divisions/JVs untouched. AS/Ltd-suffix
-- variants and sales-arm spellings merged into one row per entity.

CREATE OR REPLACE FUNCTION _merge_pub(p_cc text, p_canonical text, p_sources text[])
RETURNS void AS $fn$
DECLARE
  survivor_id text; src record; fk record; row_id text;
BEGIN
  SELECT id INTO survivor_id FROM "Publisher"
    WHERE "countryCode" = p_cc AND name = p_canonical LIMIT 1;
  IF survivor_id IS NULL THEN
    SELECT id INTO survivor_id FROM "Publisher"
      WHERE "countryCode" = p_cc AND name = ANY(p_sources)
      ORDER BY "createdAt" ASC LIMIT 1;
  END IF;
  IF survivor_id IS NULL THEN RETURN; END IF;
  UPDATE "Publisher" SET name = p_canonical WHERE id = survivor_id;
  FOR src IN SELECT id FROM "Publisher"
    WHERE "countryCode" = p_cc AND name = ANY(p_sources) AND id <> survivor_id
  LOOP
    FOR fk IN
      SELECT tc.table_name AS tbl, kcu.column_name AS col
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'Publisher' AND ccu.column_name = 'id'
        AND tc.table_schema = 'public'
    LOOP
      FOR row_id IN EXECUTE format('SELECT id FROM %I WHERE %I = $1', fk.tbl, fk.col) USING src.id
      LOOP
        BEGIN
          EXECUTE format('UPDATE %I SET %I = $1 WHERE id = $2', fk.tbl, fk.col) USING survivor_id, row_id;
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %I WHERE id = $1', fk.tbl) USING row_id;
        END;
      END LOOP;
    END LOOP;
    DELETE FROM "Publisher" WHERE id = src.id;
  END LOOP;
END; $fn$ LANGUAGE plpgsql;

-- NO: AS-suffiks-varianter av samme selskap
SELECT _merge_pub('NO', 'Aftenposten AS', ARRAY['Aftenposten', 'Aftenposten AS']);
SELECT _merge_pub('NO', 'Dagbladet AS', ARRAY['Dagbladet', 'Dagbladet AS']);
SELECT _merge_pub('NO', 'Nettavisen AS', ARRAY['Nettavisen', 'Nettavisen AS']);
SELECT _merge_pub('NO', 'Sandefjords Blad AS', ARRAY['Sandefjords Blad', 'Sandefjords Blad AS']);
SELECT _merge_pub('NO', 'Vagabond AS', ARRAY['Vagabond', 'Vagabond AS']);
SELECT _merge_pub('NO', 'VG AS', ARRAY['VG', 'VG AS']);
SELECT _merge_pub('NO', 'Vårt Land AS', ARRAY['Vårt Land', 'Vårt Land AS']);
SELECT _merge_pub('NO', 'Hegnar Media AS', ARRAY['Hegnar Media', 'Hegnar Media AS']);
SELECT _merge_pub('NO', 'Tun Media AS', ARRAY['Tun Media', 'Tun Media AS']);

-- SE: LRF Media er forlagsarmen som utgir titlene
SELECT _merge_pub('SE', 'LRF Media', ARRAY['LRF', 'LRF Media']);

-- UK: forkortede varianter av samme hus
SELECT _merge_pub('UK', 'DMG Media', ARRAY['DMG', 'DMG Media']);
SELECT _merge_pub('UK', 'Immediate Media', ARRAY['Immediate', 'Immediate Media']);
SELECT _merge_pub('UK', 'JPI Media', ARRAY['JPI', 'JPI Media']);
SELECT _merge_pub('UK', 'Tortoise Media', ARRAY['Tortoise', 'Tortoise Media']);
SELECT _merge_pub('UK', 'Bauer Media', ARRAY['Bauer', 'Bauer Consumer Media', 'Bauer Media']);

-- AT/CH/DE/IE: parentes-annoteringer og suffiks-varianter av samme enhet
SELECT _merge_pub('AT', 'Mediaprint', ARRAY['Mediaprint', 'Mediaprint (Krone + Funke 50/50)']);
SELECT _merge_pub('AT', 'Kurier Medienhaus', ARRAY['Kurier Medienhaus', 'Kurier Medienhaus (Raiffeisen + Funke)']);
SELECT _merge_pub('AT', 'Falter', ARRAY['Falter', 'Falter Zeitschriften']);
SELECT _merge_pub('CH', 'CH Media', ARRAY['CH Media', 'CH Media (NZZ + AZ Medien JV)']);
SELECT _merge_pub('CH', 'TX Group AG', ARRAY['TX Group AG', 'TX Group AG (Tamedia)']);
SELECT _merge_pub('CH', 'ESH Médias', ARRAY['ESH Médias', 'ESH Médias (Hersant)']);
SELECT _merge_pub('DE', 'Landwirtschaftsverlag Münster', ARRAY['Landwirtschaftsverlag', 'Landwirtschaftsverlag Münster']);
SELECT _merge_pub('DE', 'Springer Medizin', ARRAY['Springer Medizin', 'Springer Medizin Verlag']);
SELECT _merge_pub('IE', 'The Irish Times DAC', ARRAY['The Irish Times', 'The Irish Times DAC']);

DROP FUNCTION _merge_pub(text, text, text[]);
