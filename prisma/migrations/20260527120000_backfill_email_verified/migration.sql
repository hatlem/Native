-- Backfill emailVerifiedAt for legacy users so the new
-- "verified-or-blocked" credentials signin gate doesn't lock out
-- accounts that were created before the verification flow existed.
--
-- Treat the original signup date as proof-of-ownership for legacy
-- accounts — those users were signed in immediately at the time, so
-- the email was at least good enough to receive the welcome message.
-- New accounts will go through the magic-link verification path.

UPDATE "User"
SET "emailVerifiedAt" = "createdAt"
WHERE "emailVerifiedAt" IS NULL;
