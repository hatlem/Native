-- Final fragmented houses from the closing sweep: Kaleva Media (FI),
-- HSS Media (FI), Mentor Medier (NO) — titles sat on per-paper rows
-- with the house only in ownerGroup. Berlingske Media (DK) deliberately
-- NOT touched despite Amedia ownership (2025): houses stay per country.
DO $mig$
DECLARE
  house record; house_id text; mkt text; fk record; row_id text; old_pub record;
BEGIN
  FOR house IN SELECT * FROM (VALUES
    ('FI','Kaleva Media (FI)', ARRAY['Kaleva Media']),
    ('FI','HSS Media (FI)',    ARRAY['HSS Media']),
    ('NO','Mentor Medier (NO)',ARRAY['Mentor Medier'])
  ) AS v(cc, canonical, groups)
  LOOP
    SELECT id INTO house_id FROM "Publisher"
      WHERE "countryCode"=house.cc AND name=house.canonical LIMIT 1;
    IF house_id IS NULL THEN
      SELECT t."marketId" INTO mkt FROM "Title" t
        WHERE t."countryCode"=house.cc AND t."ownerGroup" = ANY(house.groups) LIMIT 1;
      IF mkt IS NULL THEN CONTINUE; END IF;
      INSERT INTO "Publisher"(id,name,"countryCode","marketId","pricesPublic","createdAt","updatedAt")
      VALUES ('pub_'||md5(house.cc||house.canonical), house.canonical, house.cc, mkt, true, now(), now())
      RETURNING id INTO house_id;
    END IF;

    UPDATE "Title" SET "publisherId"=house_id
    WHERE "countryCode"=house.cc AND "ownerGroup" = ANY(house.groups)
      AND "publisherId" <> house_id;

    FOR old_pub IN
      SELECT p.id FROM "Publisher" p
      WHERE p."countryCode"=house.cc AND p.id <> house_id
        AND NOT EXISTS (SELECT 1 FROM "Title" t WHERE t."publisherId"=p.id)
        AND EXISTS (SELECT 1 FROM "Title" t WHERE t."publisherId"=house_id
                    AND t."ownerGroup" = ANY(house.groups))
        AND p.name <> house.canonical
        AND p."createdAt" < now() - interval '1 minute'
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
            EXECUTE format('UPDATE %I SET %I=$1 WHERE id=$2', fk.tbl, fk.col) USING house_id, row_id;
          EXCEPTION WHEN unique_violation THEN
            EXECUTE format('DELETE FROM %I WHERE id=$1', fk.tbl) USING row_id;
          END;
        END LOOP;
      END LOOP;
      DELETE FROM "Publisher" WHERE id=old_pub.id;
    END LOOP;
  END LOOP;
END $mig$;
