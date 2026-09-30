-- Quote validity is a day on the BUYER's calendar: "valid until 21 Oct" now
-- ends at 23:59:59.999 in the buyer organisation's time zone
-- (src/lib/commerce/quote-validity.ts parseQuoteValidUntil, zones from
-- src/lib/markets.ts MARKET_TIME_ZONES). Quotes sent before stored
-- 23:59:59.999 UTC of the chosen day, which in every served market is
-- already the next calendar day locally (01:59 on the 22nd in Oslo): the
-- desk printed the 22nd, the buyer page the 21st, and the buyer could still
-- accept into the small hours of the 22nd.
--
-- Data only, no schema change. Moves exactly those rows (the day-end
-- signature 23:59:59.999; the blank-field default was "now + 14 days" and
-- never lands on it) to the end of the SAME calendar day in the org's zone,
-- i.e. the date the buyer was shown. An org without a billing market uses
-- the desk's zone, Europe/Oslo (HOUSE_TIME_ZONE).
--
-- Reverse (if ever needed): for the same orgs,
--   "validUntil" = (("validUntil" AT TIME ZONE 'UTC') AT TIME ZONE <zone>)::date
--                  + interval '1 day' - interval '1 millisecond'
-- restores 23:59:59.999 UTC of the day.

UPDATE "Quote" AS q
SET "validUntil" =
  (((q."validUntil"::date + 1)::timestamp - interval '1 millisecond') AT TIME ZONE z.zone)
    AT TIME ZONE 'UTC'
FROM "Request" AS r
JOIN "Organization" AS o ON o."id" = r."organizationId"
CROSS JOIN LATERAL (
  SELECT CASE o."marketCode"::text
    WHEN 'NO' THEN 'Europe/Oslo'
    WHEN 'SE' THEN 'Europe/Stockholm'
    WHEN 'DK' THEN 'Europe/Copenhagen'
    WHEN 'FI' THEN 'Europe/Helsinki'
    WHEN 'DE' THEN 'Europe/Berlin'
    WHEN 'AT' THEN 'Europe/Vienna'
    WHEN 'CH' THEN 'Europe/Zurich'
    WHEN 'UK' THEN 'Europe/London'
    WHEN 'IE' THEN 'Europe/Dublin'
    ELSE 'Europe/Oslo'
  END AS zone
) AS z
WHERE r."id" = q."requestId"
  AND q."validUntil" IS NOT NULL
  AND q."validUntil"::time = time '23:59:59.999';
