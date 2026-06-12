-- Fold the two remaining Akersposten-family duplicates into their confirmed
-- survivors. Both dupes are UNVERIFIED-product seed rows; the Henriette/Amedia
-- deal (contacts, quotes, commercialExtra) already lives on the survivors, so
-- nothing is lost. Old names go into the survivors' aliases so FTS keeps
-- matching them (the dedup-without-alias lesson).

UPDATE "Title" SET
  aliases = array_append(aliases, 'Akersposten (gratisavis)'),
  "updatedAt" = now()
WHERE slug = 'akersposten-no'
  AND NOT 'Akersposten (gratisavis)' = ANY(aliases);

UPDATE "Title" SET
  aliases = array_append(aliases, 'Ullern Avis / Akersposten'),
  "updatedAt" = now()
WHERE slug = 'ullern-avis-no'
  AND NOT 'Ullern Avis / Akersposten' = ANY(aliases);

UPDATE "Product" SET active = false, bookable = false, "updatedAt" = now()
WHERE "titleId" IN (
  SELECT id FROM "Title"
  WHERE slug IN ('akersposten-gratisavis-no', 'ullern-avis-akersposten-no')
);

UPDATE "Title" SET
  active = false,
  "discontinuedNote" = 'Duplikat — slått sammen med ' ||
    CASE slug WHEN 'akersposten-gratisavis-no' THEN 'akersposten-no' ELSE 'ullern-avis-no' END ||
    ' (2026-06-12)',
  "updatedAt" = now()
WHERE slug IN ('akersposten-gratisavis-no', 'ullern-avis-akersposten-no');
