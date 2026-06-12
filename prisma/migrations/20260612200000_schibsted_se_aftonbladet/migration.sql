-- Aftonbladet -> Schibsted (SE) (remaining Schibsted SE flagship;
-- SvD/Omni/TV.nu/Klart already grouped via ownerGroup pass).
DO $mig$
DECLARE schib_id text; fk record; row_id text; old_id text;
BEGIN
  SELECT id INTO schib_id FROM "Publisher" WHERE "countryCode"='SE' AND name='Schibsted (SE)';
  IF schib_id IS NULL THEN RETURN; END IF;
  UPDATE "Title" SET "publisherId"=schib_id, "ownerGroup"='Schibsted'
  WHERE slug='aftonbladet-se';
  SELECT id INTO old_id FROM "Publisher" WHERE "countryCode"='SE' AND name='Aftonbladet'
    AND NOT EXISTS (SELECT 1 FROM "Title" t WHERE t."publisherId"="Publisher".id);
  IF old_id IS NOT NULL THEN
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
      FOR row_id IN EXECUTE format('SELECT id FROM %I WHERE %I=$1', fk.tbl, fk.col) USING old_id
      LOOP
        BEGIN
          EXECUTE format('UPDATE %I SET %I=$1 WHERE id=$2', fk.tbl, fk.col) USING schib_id, row_id;
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %I WHERE id=$1', fk.tbl) USING row_id;
        END;
      END LOOP;
    END LOOP;
    DELETE FROM "Publisher" WHERE id=old_id;
  END IF;
END $mig$;
