-- Runs after 20260607120000 so the PUBLISHER_FORM enum value is committed
-- before it is referenced (Postgres forbids using a new enum value in the
-- same transaction that adds it).
UPDATE "BookingMetrics" SET "source" = 'PUBLISHER_FORM' WHERE "source" = 'PUBLISHER';
