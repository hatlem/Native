-- Gota Media reconciled vs gotamedia.se/varumarken. The official list
-- now spans the merged Bonnier News Local + Gota local portfolio
-- (announced autumn 2025): Sydsvenskan/HD, ex-Hall Media (JP, FT, SLT,
-- Smalands Dagblad, Smalanningen, Norra Skane) and 13 ex-BNL titles
-- move under Gota Media (SE). Hultsfreds-Tidningen is a Barometern
-- edition (NTM attribution was wrong). SE only.
DO $mig$
DECLARE
  gota_id text; fk record; row_id text; old_pub record;
BEGIN
  SELECT id INTO gota_id FROM "Publisher" WHERE "countryCode"='SE' AND name='Gota Media (SE)';
  IF gota_id IS NULL THEN RETURN; END IF;

  UPDATE "Title" SET "publisherId"=gota_id, "ownerGroup"='Gota Media'
  WHERE slug IN ('sydsvenskan-se','jo-nko-pings-posten-se','nyna-shamns-posten-se','norrtelje-tidning-se','la-nstidningen-o-stersund-se','fagersta-posten-se','skaraborgs-la-ns-tidning-se','hultsfreds-tidningen-se','tidningen-a-ngermanland-se','o-rnsko-ldsviks-allehanda-se','falko-pings-tidning-se','ska-nska-dagbladet-se','helsingborgs-dagblad-se','vestmanlands-la-ns-tidning-se','nerikes-allehanda-se','arbetarbladet-se','o-stersunds-posten-se','gefle-dagblad-se','dala-demokraten-se','norra-ska-ne-se','sma-lands-dagblad-se','sma-la-nningen-se');

  FOR old_pub IN
    SELECT p.id FROM "Publisher" p
    WHERE p."countryCode"='SE' AND p.id <> gota_id
      AND p.name IN ('JP','Norra Skåne','SmD','Smålänningen','Bonnier News Local (SE)')
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
          EXECUTE format('UPDATE %I SET %I=$1 WHERE id=$2', fk.tbl, fk.col) USING gota_id, row_id;
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %I WHERE id=$1', fk.tbl) USING row_id;
        END;
      END LOOP;
    END LOOP;
    DELETE FROM "Publisher" WHERE id=old_pub.id;
  END LOOP;
END $mig$;
