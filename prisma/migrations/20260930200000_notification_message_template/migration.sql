-- In-app notifications were stored as finished strings in ONE language,
-- chosen by the org's home market at write time — a Norwegian user in a
-- Swedish-market org read Swedish. A templated notice now also stores its
-- template key + parameters, and /notifications re-renders it in the
-- viewer's own locale (title/body stay as the email-language fallback and
-- for legacy rows). See src/lib/notice-template.ts.
-- Additive, nullable; revert with:
--   ALTER TABLE "Notification" DROP COLUMN "messageKey", DROP COLUMN "messageParams";
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "messageKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "messageParams" JSONB;
