-- Correct stale ownerGroup='Schibsted' on NO locals (user-verified
-- against amedia.no/aviser and Polaris ownership):
--   Dalane Tidende, Jærbladet (+Aftenbladet Bryne), Sandefjords Blad -> Amedia
--   Lister (Farsunds Avis, via Polaris Media Sør), Lindesnes (via
--   Fædrelandsvennen) -> Polaris Media
-- Sandnesposten/Solabladet: ownership unverified -> ownerGroup cleared
-- (kept as standalone publishers until confirmed).

DO $mig$
DECLARE
  amedia_id text; polaris_id text; fk record; row_id text; old_pub record;
BEGIN
  SELECT id INTO amedia_id  FROM "Publisher" WHERE "countryCode"='NO' AND name='Amedia (NO)';
  SELECT id INTO polaris_id FROM "Publisher" WHERE "countryCode"='NO' AND name='Polaris Media (NO)';
  IF amedia_id IS NULL OR polaris_id IS NULL THEN RETURN; END IF;

  UPDATE "Title" SET "publisherId"=amedia_id, "ownerGroup"='Amedia'
  WHERE slug IN ('dalane-tidende-no','j-rbladet-no','aftenbladet-bryne-no',
                 'sandefjords-blad-no','sandefjords-blad-amedia-no');

  UPDATE "Title" SET "publisherId"=polaris_id, "ownerGroup"='Polaris Media'
  WHERE slug IN ('lister-farsunds-avis-no','lindesnes-no','lindesnes-avis-nord-no');

  UPDATE "Title" SET "ownerGroup"=NULL
  WHERE slug IN ('sandnesposten-no','solabladet-no');

  -- Fold the now-empty legal-entity rows into their houses.
  FOR old_pub IN
    SELECT p.id, CASE WHEN p.name IN ('Farsunds Avis AS','Lindesnes Avis AS')
                      THEN polaris_id ELSE amedia_id END AS target
    FROM "Publisher" p
    WHERE p."countryCode"='NO'
      AND p.name IN ('Dalane Tidende AS','Jærbladet AS','Sandefjords Blad AS',
                     'Farsunds Avis AS','Lindesnes Avis AS')
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
        AND ccu.table_name='Publisher' AND ccu.column_name='id'
        AND tc.table_schema='public'
    LOOP
      FOR row_id IN EXECUTE format('SELECT id FROM %I WHERE %I=$1', fk.tbl, fk.col) USING old_pub.id
      LOOP
        BEGIN
          EXECUTE format('UPDATE %I SET %I=$1 WHERE id=$2', fk.tbl, fk.col) USING old_pub.target, row_id;
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %I WHERE id=$1', fk.tbl) USING row_id;
        END;
      END LOOP;
    END LOOP;
    DELETE FROM "Publisher" WHERE id=old_pub.id;
  END LOOP;
END $mig$;
