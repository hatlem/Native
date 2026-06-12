-- Amedia ownership reconciled against the official list at
-- amedia.no/aviser/amedias-aviser (user-supplied source, 108 papers).
-- 26 catalog titles matched but sat under per-title rows / Tun Media /
-- stale Polaris attribution. Conflict handling: iHarstad and Arbeidets
-- Rett carry Polaris-priced products from the Polaris rate-sheet ingest
-- but are Amedia-owned per the official list -> ownership moves to
-- Amedia, products kept, desk flagged via outstandingInfo.

DO $mig$
DECLARE
  amedia_id text; fk record; row_id text; old_pub record;
  slugs text[] := ARRAY[
    'bondebladet-no','norsk-landbruk-no','nationen-no',
    'iharstad-no','arbeidets-rett-no',
    'sandnesposten-no','solabladet-no',
    'budstikka-no','hordaland-no','drangedalsposten-no','solungavisa-no',
    'sydvesten-no','gjesdalbuen-no','lokalavisa-trysil-engerdal-no',
    'sagene-avis-no','vaksdalposten-no','a-sane-tidende-no',
    'kronstadposten-no','enebakk-avis-no','stangeavisa-no',
    'bygdebladet-no','fanaposten-no','hammerfestingen-no',
    'lyngdals-avis-no','nordre-aker-budstikke-no','strandbuen-no'
  ];
BEGIN
  SELECT id INTO amedia_id FROM "Publisher" WHERE "countryCode"='NO' AND name='Amedia (NO)';
  IF amedia_id IS NULL THEN RETURN; END IF;

  UPDATE "Title" SET "publisherId"=amedia_id, "ownerGroup"='Amedia'
  WHERE slug = ANY(slugs);

  -- Desk flag on the two ingest-conflict titles.
  UPDATE "Title"
  SET "outstandingInfo" = array_append("outstandingInfo",
    'Verifiser salgshus: Polaris-prisede produkter, men Amedia-eid iflg. amedia.no/aviser')
  WHERE slug IN ('iharstad-no','arbeidets-rett-no')
    AND NOT ('Verifiser salgshus: Polaris-prisede produkter, men Amedia-eid iflg. amedia.no/aviser' = ANY("outstandingInfo"));

  -- Fold now-empty legal-entity rows into Amedia (contacts survive).
  FOR old_pub IN
    SELECT p.id FROM "Publisher" p
    WHERE p."countryCode"='NO' AND p.id <> amedia_id
      AND NOT EXISTS (SELECT 1 FROM "Title" t WHERE t."publisherId"=p.id)
      AND p.name IN ('Tun Media AS','Sandnesposten AS','Solabladet AS',
        'Asker og Bærums Budstikke ASA','Hordaland AS','Drangedalsposten AS',
        'SolungAvisa','Sydvesten','Gjesdalbuen AS','LA Trysil Engerdal',
        'Sagene Avis','Vaksdalposten','Åsane Tidende','Kronstadposten',
        'Enebakk Avis AS','Stangeavisa','Bygdebladet AS','Fanaposten AS',
        'Hammerfestingen','Lyngdals Avis','Nordre Aker Budstikke','Strandbuen AS')
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
          EXECUTE format('UPDATE %I SET %I=$1 WHERE id=$2', fk.tbl, fk.col) USING amedia_id, row_id;
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %I WHERE id=$1', fk.tbl) USING row_id;
        END;
      END LOOP;
    END LOOP;
    DELETE FROM "Publisher" WHERE id=old_pub.id;
  END LOOP;
END $mig$;
