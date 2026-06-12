-- Media-house ownership (NO): the publisher drill-down groups by the
-- selling media house, not the per-title legal entity. User-confirmed:
-- Dagbladet -> Aller Media; Aftenposten, VG -> Schibsted. Extended with
-- the house's other certain NO properties (E24, Bergens Tidende,
-- Stavanger Aftenblad = Schibsted; Se og Hør = Aller; Nettavisen =
-- Amedia). Per country only, as always.

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

-- Schibsted (NO): Aftenposten-familien, VG, E24, Bergens Tidende,
-- Stavanger Aftenblad. (Faktisk.no-JV-raden røres ikke.)
SELECT _merge_pub('NO', 'Schibsted (NO)', ARRAY[
  'Schibsted', 'Schibsted (NO)', 'Aftenposten AS', 'VG AS', 'E24 AS',
  'Bergens Tidende AS', 'Stavanger Aftenblad ASA'
]);

-- Aller Media (NO): Dagbladet-husene + Se og Hør.
SELECT _merge_pub('NO', 'Aller Media (NO)', ARRAY[
  'Aller Media (NO)', 'Dagbladet AS', 'Se og Hør'
]);

-- Amedia (NO): Nettavisen.
SELECT _merge_pub('NO', 'Amedia (NO)', ARRAY['Amedia (NO)', 'Nettavisen AS']);

DROP FUNCTION _merge_pub(text, text, text[]);
