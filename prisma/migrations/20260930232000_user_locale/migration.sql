-- Per-recipient language for emails and notices. Until now a notice's email
-- went out in the org's home-market language (desk mail always in English),
-- so a writer invited in Norwegian got an English assignment and a Swedish
-- user in a Norwegian org read Norwegian. User.locale records the language
-- the user actually uses (latest sign-in UI locale, or the invite language),
-- and PublisherInvite.locale the language the desk sent the invite in, as
-- WriterInvite already does. See src/lib/notify.ts.
-- Additive (nullable / defaulted); revert with:
--   ALTER TABLE "User" DROP COLUMN "locale";
--   ALTER TABLE "PublisherInvite" DROP COLUMN "locale";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "locale" TEXT;
ALTER TABLE "PublisherInvite" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'en';
