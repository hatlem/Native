-- Media-house grouping driven by Title.ownerGroup (research data), per
-- country. Titles whose ownerGroup names a media house get repointed to
-- one canonical "House (CC)" publisher row; per-title legal-entity rows
-- that end up empty are merged in (contacts survive via FK repoint).
-- Deliberately skipped: ownerGroup='Schibsted' on NO locals (stale —
-- sold to Polaris 2020) and 'Selvstendig/Selvstændig' (correctly
-- independent). Never merged across countries.

CREATE OR REPLACE FUNCTION _house(p_cc text, p_canonical text, p_groups text[])
RETURNS void AS $fn$
DECLARE
  house_id text; mkt text; old_pub record; fk record; row_id text;
BEGIN
  SELECT id INTO house_id FROM "Publisher"
    WHERE "countryCode" = p_cc AND name = p_canonical LIMIT 1;
  IF house_id IS NULL THEN
    SELECT t."marketId" INTO mkt FROM "Title" t
      WHERE t."countryCode" = p_cc AND t."ownerGroup" = ANY(p_groups) LIMIT 1;
    IF mkt IS NULL THEN RETURN; END IF;
    INSERT INTO "Publisher" (id, name, "countryCode", "marketId", "pricesPublic", "createdAt", "updatedAt")
    VALUES ('pub_' || md5(p_cc || p_canonical), p_canonical, p_cc, mkt, true, now(), now())
    RETURNING id INTO house_id;
  END IF;

  -- Repoint the titles to the house.
  UPDATE "Title" SET "publisherId" = house_id
  WHERE "countryCode" = p_cc AND "ownerGroup" = ANY(p_groups)
    AND "publisherId" <> house_id;

  -- Fold now-empty legal-entity rows (their contacts etc.) into the house.
  FOR old_pub IN
    SELECT p.id FROM "Publisher" p
    WHERE p."countryCode" = p_cc AND p.id <> house_id
      AND NOT EXISTS (SELECT 1 FROM "Title" t WHERE t."publisherId" = p.id)
      AND EXISTS ( -- only rows that just lost titles to this house
        SELECT 1 FROM "Title" t WHERE t."publisherId" = house_id
          AND t."ownerGroup" = ANY(p_groups))
      AND p."createdAt" < now() - interval '1 minute'
      AND p.name <> p_canonical
      -- guard: only fold rows that no OTHER country/house still references
      AND NOT EXISTS (SELECT 1 FROM "PublisherInvite" pi WHERE pi."publisherId" = p.id)
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
      FOR row_id IN EXECUTE format('SELECT id FROM %I WHERE %I = $1', fk.tbl, fk.col) USING old_pub.id
      LOOP
        BEGIN
          EXECUTE format('UPDATE %I SET %I = $1 WHERE id = $2', fk.tbl, fk.col) USING house_id, row_id;
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %I WHERE id = $1', fk.tbl) USING row_id;
        END;
      END LOOP;
    END LOOP;
    DELETE FROM "Publisher" WHERE id = old_pub.id;
  END LOOP;
END; $fn$ LANGUAGE plpgsql;

-- Norge
SELECT _house('NO', 'Amedia (NO)', ARRAY['Amedia']);
SELECT _house('NO', 'Polaris Media (NO)', ARRAY['Polaris Media']);
SELECT _house('NO', 'Universitetsforlaget', ARRAY['Universitetsforlaget']);
SELECT _house('NO', 'LO Media', ARRAY['LO Media']);
SELECT _house('NO', 'Cappelen Damm', ARRAY['Cappelen Damm']);

-- Sverige
SELECT _house('SE', 'Bonnier News Local (SE)', ARRAY['Bonnier News Local']);
SELECT _house('SE', 'Gota Media (SE)', ARRAY['Gota Media']);
SELECT _house('SE', 'NWT Media (SE)', ARRAY['NWT-koncernen']);
SELECT _house('SE', 'NTM (SE)', ARRAY['NTM']);
SELECT _house('SE', 'Polaris Media (SE)', ARRAY['Polaris Media']);
SELECT _house('SE', 'Schibsted (SE)', ARRAY['Schibsted']);
SELECT _house('SE', 'Sörmlands Media (SE)', ARRAY['Sörmlands Media']);
SELECT _house('SE', 'Svenska Docu Media (SE)', ARRAY['Svenska Docu Media']);

-- Danmark
SELECT _house('DK', 'JP/Politikens Hus (DK)', ARRAY['JP/Politikens Hus']);
SELECT _house('DK', 'Jysk Fynske Medier (DK)', ARRAY['Jysk Fynske Medier']);

-- Finland
SELECT _house('FI', 'Keskisuomalainen (FI)', ARRAY['Keskisuomalainen Oyj']);
SELECT _house('FI', 'I-Mediat (FI)', ARRAY['I-Mediat']);
SELECT _house('FI', 'TS-Yhtymä (FI)', ARRAY['TS-Yhtymä']);

-- UK / Irland
SELECT _house('UK', 'National World (UK)', ARRAY['National World']);
SELECT _house('UK', 'Reach plc (UK)', ARRAY['Reach plc']);
SELECT _house('UK', 'Mark Allen Group (UK)', ARRAY['Mark Allen']);
SELECT _house('IE', 'Mediahuis Ireland (IE)', ARRAY['Mediahuis Ireland']);

DROP FUNCTION _house(text, text, text[]);
