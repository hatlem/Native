-- NTM reconciled vs ntm.se/vara-bolag-och-varumarken: 10 titles moved
-- (Sormlands Media is NTM-owned; NSD, Norran, Gotland papers, Pitea-
-- Tidningen per official domain list). SE only.
DO $mig$
DECLARE
  ntm_id text; fk record; row_id text; old_pub record;
BEGIN
  SELECT id INTO ntm_id FROM "Publisher" WHERE "countryCode"='SE' AND name='NTM (SE)';
  IF ntm_id IS NULL THEN RETURN; END IF;

  UPDATE "Title" SET "publisherId"=ntm_id, "ownerGroup"='NTM'
  WHERE slug IN ('norrla-ndska-socialdemokraten-se','norra-va-sterbotten-se','so-dermanlands-nyheter-se','strengna-s-tidning-se','katrineholms-kuriren-se','norran-se','gotlands-allehanda-se','gotlands-tidningar-se','eskilstuna-kuriren-se','pitea-tidningen-se');

  FOR old_pub IN
    SELECT p.id FROM "Publisher" p
    WHERE p."countryCode"='SE' AND p.id <> ntm_id
      AND p.name IN ('NSD','NV','Norran','GA','GT','PT','Sörmlands Media (SE)')
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
          EXECUTE format('UPDATE %I SET %I=$1 WHERE id=$2', fk.tbl, fk.col) USING ntm_id, row_id;
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %I WHERE id=$1', fk.tbl) USING row_id;
        END;
      END LOOP;
    END LOOP;
    DELETE FROM "Publisher" WHERE id=old_pub.id;
  END LOOP;
END $mig$;
