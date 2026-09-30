-- Writer invites are now emailed (they used to be link-only, copied by
-- hand from the desk). Record the email language and when it went out so
-- the desk can see a failed send and resend it.
-- Additive; revert with:
--   ALTER TABLE "WriterInvite" DROP COLUMN "locale", DROP COLUMN "emailedAt";
ALTER TABLE "WriterInvite" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "WriterInvite" ADD COLUMN "emailedAt" TIMESTAMP(3);
