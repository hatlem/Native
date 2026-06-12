-- Aller NO reconciled vs aller.no/merkevarer (sitemap): Vi over 60,
-- Dinside, Kode24 moved under Aller Media (NO). Kode24 sat under TU
-- Media (research error; kode24 is Aller's db medialab brand).
DO $mig$
DECLARE
  aller_id text; fk record; row_id text; old_pub record;
BEGIN
  SELECT id INTO aller_id FROM "Publisher" WHERE "countryCode"='NO' AND name='Aller Media (NO)';
  IF aller_id IS NULL THEN RETURN; END IF;

  UPDATE "Title" SET "publisherId"=aller_id, "ownerGroup"='Aller Media'
  WHERE slug IN ('vi-over-60-no','dinside-no','kode24-no');

  FOR old_pub IN
    SELECT p.id FROM "Publisher" p
    WHERE p."countryCode"='NO' AND p.id <> aller_id
      AND p.name IN ('Vi over 60 AS','Dinside')
      AND NOT EXISTS (SELECT 1 FROM "Title" t WHERE t."publisherId"=p.id)
  LOOP
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
      FOR row_id IN EXECUTE format('SELECT id FROM %I WHERE %I=$1', fk.tbl, fk.col) USING old_pub.id
      LOOP
        BEGIN
          EXECUTE format('UPDATE %I SET %I=$1 WHERE id=$2', fk.tbl, fk.col) USING aller_id, row_id;
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %I WHERE id=$1', fk.tbl) USING row_id;
        END;
      END LOOP;
    END LOOP;
    DELETE FROM "Publisher" WHERE id=old_pub.id;
  END LOOP;
END $mig$;
