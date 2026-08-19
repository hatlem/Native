-- Share-link engagement: view stamp/count + the client's approval click,
-- and the notification kind that tells the buyer about it.
ALTER TYPE "NotificationKind" ADD VALUE 'PLAN_CLIENT_APPROVED';
ALTER TABLE "SavedList" ADD COLUMN "shareViewedAt" TIMESTAMP(3),
                        ADD COLUMN "shareViewCount" INTEGER NOT NULL DEFAULT 0,
                        ADD COLUMN "clientApprovedAt" TIMESTAMP(3);
