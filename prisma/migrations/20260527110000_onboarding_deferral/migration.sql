-- Onboarding deferral: defer Faktureringsmarked + phone to a post-signup
-- onboarding flow so signup itself stays at name + company + email (+
-- optional password). Both columns nullable; the onboarding page
-- enforces fill-in before the user can submit an RFQ.

-- 1. User.phone (new, nullable)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;

-- 2. Organization.marketCode → nullable
ALTER TABLE "Organization" ALTER COLUMN "marketCode" DROP NOT NULL;
