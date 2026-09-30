-- One-off data repair: publisher bookings created by the quote-accept path
-- (lib/commerce/accept-quote.ts) were written with only orderLineId, so
-- titleId/publisherId stayed NULL. The campaign report showed "—" for
-- publisher and title, the CSV rows were empty, and the metrics sweep (which
-- groups bookings by publisherId) could never build a request for them.
-- The code now anchors every booking at creation (lib/commerce/bookings.ts);
-- this fills the rows already in the database from the same chain:
-- orderLine -> product -> title -> publisher.
--
-- Idempotent (only touches rows still missing an anchor, never overwrites a
-- value that is set) and data-only: no schema change to reverse.

UPDATE "PublisherBooking" b
SET "titleId"     = COALESCE(b."titleId", t.id),
    "publisherId" = COALESCE(b."publisherId", t."publisherId")
FROM "OrderLine" ol
JOIN "Product" pr ON pr.id = ol."productId"
JOIN "Title" t ON t.id = pr."titleId"
WHERE ol.id = b."orderLineId"
  AND (b."titleId" IS NULL OR b."publisherId" IS NULL);
