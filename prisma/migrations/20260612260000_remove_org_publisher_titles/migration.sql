-- User decision 2026-06-12: NTNU is a university and NHO a trade
-- organisation — their in-house publications are not native-ad inventory
-- and must not receive outreach. Deactivate the org-published titles.
-- Beauty Forum is NOT removed: it is a commercial trade magazine that was
-- miscategorised under "NHO (NO)" — it gets its own publisher instead.

UPDATE "Product" SET active = false, bookable = false, "updatedAt" = now()
WHERE "titleId" IN (
  SELECT t.id FROM "Title" t
  JOIN "Publisher" p ON p.id = t."publisherId"
  WHERE (p.name = 'NTNU (NO)')
     OR (p.name = 'NHO (NO)' AND t.name = 'NHO Magasinet')
);

UPDATE "Title" SET
  active = false,
  "discontinuedNote" = 'Fjernet 2026-06-12: organisasjonsutgivelse (universitet/interesseorg), ikke annonseinventar',
  "updatedAt" = now()
WHERE id IN (
  SELECT t.id FROM "Title" t
  JOIN "Publisher" p ON p.id = t."publisherId"
  WHERE (p.name = 'NTNU (NO)')
     OR (p.name = 'NHO (NO)' AND t.name = 'NHO Magasinet')
);

-- Beauty Forum -> its real publisher (own imprint, Health & Beauty trade
-- media family). Create-or-reuse a dedicated publisher row in NO.
DO $$
DECLARE pid text;
BEGIN
  SELECT id INTO pid FROM "Publisher" WHERE name = 'Beauty Forum Norge (NO)';
  IF pid IS NULL THEN
    INSERT INTO "Publisher" (id, name, "countryCode", "marketId", "pricesPublic", "createdAt", "updatedAt")
    SELECT 'pub_' || md5('Beauty Forum Norge (NO)'), 'Beauty Forum Norge (NO)', 'NO', m.id, true, now(), now()
    FROM "Market" m WHERE m.code = 'NO'
    RETURNING id INTO pid;
  END IF;
  UPDATE "Title" SET "publisherId" = pid, "updatedAt" = now()
  WHERE name = 'Beauty Forum' AND "countryCode" = 'NO';
END $$;
