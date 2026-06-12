-- Polaris Media ownership reconciled against polarismedia.no/vare-selskaper
-- (all five NO regions + Stampen). 26 titles moved, incl. 8 that the stale
-- research ownerGroup had wrongly placed under Amedia (their domains are on
-- Polaris' official region pages and absent from amedia.no's list).
-- Norsk Fiskerinæring NOT moved: its websiteUrl (kystogfjord.no) is wrong
-- in our data -> flagged for desk instead. SE: Polaris' Swedish house
-- operates as Stampen Media -> row renamed accordingly.

DO $mig$
DECLARE
  polaris_id text; fk record; row_id text; old_pub record;
  slugs text[] := ARRAY[
    -- feilplassert under Amedia (research-feil; polarismedia.no er kilde)
    'grimstad-adressetidende-no','vigga-no','fjordingen-no',
    'fjordenes-tidende-no','troms-folkeblad-no','vestera-len-online-no',
    'br-nn-ysunds-avis-no','framtid-i-nord-no',
    -- frittstående rader med domener på offisiell Polaris-liste
    'setesd-len-no','kyst-og-fjord-no','marsteinen-no','fjordabladet-no',
    'and-yposten-no','b-mlo-nytt-no','kl-buposten-no','kulingen-no',
    'lillesands-posten-no','driva-no','d-len-no','fjuken-no','nyss-no',
    'stord24-no','vesteraalens-avis-no','vennesla-tidende-no',
    'va-ganavisa-no','a-ndalsnes-avis-no'
  ];
BEGIN
  SELECT id INTO polaris_id FROM "Publisher" WHERE "countryCode"='NO' AND name='Polaris Media (NO)';
  IF polaris_id IS NULL THEN RETURN; END IF;

  UPDATE "Title" SET "publisherId"=polaris_id, "ownerGroup"='Polaris Media'
  WHERE slug = ANY(slugs);

  -- Feil URL i data — ikke flytt på dårlig grunnlag, flagg desk.
  UPDATE "Title"
  SET "outstandingInfo" = array_append("outstandingInfo",
    'websiteUrl peker på kystogfjord.no — feil for Norsk Fiskerinæring; verifiser riktig URL og eierskap')
  WHERE slug = 'norsk-fiskerin-ring-no'
    AND NOT ('websiteUrl peker på kystogfjord.no — feil for Norsk Fiskerinæring; verifiser riktig URL og eierskap' = ANY("outstandingInfo"));

  -- Fold tomme legal-entity-rader inn i Polaris.
  FOR old_pub IN
    SELECT p.id FROM "Publisher" p
    WHERE p."countryCode"='NO' AND p.id <> polaris_id
      AND NOT EXISTS (SELECT 1 FROM "Title" t WHERE t."publisherId"=p.id)
      AND p.name IN ('Setesdølen AS','Kyst og Fjord AS','Marsteinen','Fjordabladet AS',
        'Andøyposten AS','Bømlo-Nytt AS','Klæbuposten','Kulingen',
        'Lillesands-Posten AS','Driva-Trykk AS','Dølen AS','Skjåk Mediautvikling AS',
        'Nyss AS','Stord24','Vesterålens Avis AS','Vennesla Tidende',
        'Våganavisa','Åndalsnes Avis')
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
          EXECUTE format('UPDATE %I SET %I=$1 WHERE id=$2', fk.tbl, fk.col) USING polaris_id, row_id;
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %I WHERE id=$1', fk.tbl) USING row_id;
        END;
      END LOOP;
    END LOOP;
    DELETE FROM "Publisher" WHERE id=old_pub.id;
  END LOOP;

  -- SE: Polaris' svenske hus opererer som Stampen Media.
  UPDATE "Publisher" SET name='Stampen Media (SE)'
  WHERE "countryCode"='SE' AND name='Polaris Media (SE)';
END $mig$;
