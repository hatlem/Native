-- Canonical media-house publishers, PER COUNTRY (never merged across
-- borders — national arms are separate sales orgs with separate prices).
-- Naming convention: "Concern (CC)". Fixes sales-region fragments like
-- "Amedia VOL"/"Amedia Lokal" that are not real publisher names.
-- Real divisions (Bonnier News vs Bonnier Magazines & Brands) and real
-- subsidiaries (Polaris regional houses) are deliberately NOT merged.

CREATE OR REPLACE FUNCTION _merge_pub(p_cc text, p_canonical text, p_sources text[])
RETURNS void AS $fn$
DECLARE
  survivor_id text;
  src record;
  fk record;
  row_id text;
BEGIN
  -- Survivor: the row already carrying the canonical name, else the oldest source.
  SELECT id INTO survivor_id FROM "Publisher"
    WHERE "countryCode" = p_cc AND name = p_canonical LIMIT 1;
  IF survivor_id IS NULL THEN
    SELECT id INTO survivor_id FROM "Publisher"
      WHERE "countryCode" = p_cc AND name = ANY(p_sources)
      ORDER BY "createdAt" ASC LIMIT 1;
  END IF;
  IF survivor_id IS NULL THEN RETURN; END IF;

  UPDATE "Publisher" SET name = p_canonical WHERE id = survivor_id;

  FOR src IN
    SELECT id FROM "Publisher"
    WHERE "countryCode" = p_cc AND name = ANY(p_sources) AND id <> survivor_id
  LOOP
    -- Repoint every FK that references Publisher(id), discovered dynamically
    -- so new tables can't be silently missed.
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
      -- Row-by-row so a unique collision (e.g. same SalesContact email on
      -- both rows) deletes only the true duplicate, not the batch.
      FOR row_id IN
        EXECUTE format('SELECT id FROM %I WHERE %I = $1', fk.tbl, fk.col) USING src.id
      LOOP
        BEGIN
          EXECUTE format('UPDATE %I SET %I = $1 WHERE id = $2', fk.tbl, fk.col)
            USING survivor_id, row_id;
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %I WHERE id = $1', fk.tbl) USING row_id;
        END;
      END LOOP;
    END LOOP;
    DELETE FROM "Publisher" WHERE id = src.id;
  END LOOP;
END; $fn$ LANGUAGE plpgsql;

-- Amedia (NO): VOL/Lokal are internal sales regions, not publishers.
SELECT _merge_pub('NO', 'Amedia (NO)', ARRAY['Amedia', 'Amedia VOL', 'Amedia Lokal', 'Amedia (NO)']);

-- Aller Media, per land (aldri på tvers).
SELECT _merge_pub('NO', 'Aller Media (NO)', ARRAY['Aller', 'Aller Media', 'Aller Media (NO)']);
SELECT _merge_pub('SE', 'Aller Media (SE)', ARRAY['Aller', 'Aller Media', 'Aller Media (SE)', 'Aller Media SE']);
SELECT _merge_pub('DK', 'Aller Media (DK)', ARRAY['Aller', 'Aller Media', 'Aller Media (DK)', 'Aller Media Business DK']);

-- Egmont, per land. Hjemmet Mortensen = Egmonts norske arm (historisk navn).
SELECT _merge_pub('NO', 'Egmont (NO)', ARRAY['Egmont', 'Egmont Hjemmet Mortensen', 'Egmont (NO)']);
SELECT _merge_pub('SE', 'Egmont (SE)', ARRAY['Egmont', 'Story House Egmont', 'Egmont (SE)']);
SELECT _merge_pub('DK', 'Egmont (DK)', ARRAY['Egmont', 'Egmont (DK)']);

-- Bonnier (SE): kun stavevarianten — divisjonene (News/Magazines/Publications)
-- er reelle salgsorganisasjoner og beholdes separat.
SELECT _merge_pub('SE', 'Bonnier (SE)', ARRAY['Bonnier', 'Bonniers', 'Bonnier (SE)']);

DROP FUNCTION _merge_pub(text, text, text[]);
