-- 1. The plan brief lives on the plan. /plan's brief fields (what the campaign
--    sells, preferred timing, budget, audience segments, geography, context)
--    were only kept in a cookie across an onboarding detour, so they were lost
--    on every navigation and shared between plans. budget / currency /
--    targetAudience / targetGeo / targetContext already exist on SavedList;
--    the free-text brief and the timing pick are new.
ALTER TABLE "SavedList" ADD COLUMN "briefText" TEXT;
ALTER TABLE "SavedList" ADD COLUMN "briefTiming" TEXT;

-- 2. A client approval is an approval of ONE version of the plan. The share
--    page posts the version it showed; the approval stores it, and a plan
--    whose lines changed since reads "approved before changes" instead of
--    "approved" (lib/list-share.ts). The value is the SHA-256 of
--    fingerprintListItems() over the plan's committed lines (alternatives
--    excluded), the same identity the firm-order guard uses.
--
--    No backfill: nothing records which version an existing approval was
--    for, and plans were edited after approval without resetting it (the bug
--    this fixes). Existing approvals therefore read "approved before changes"
--    until the client approves again; never a stale approval shown as current.
ALTER TABLE "SavedList" ADD COLUMN "clientApprovedVersion" TEXT;

-- Down:
--   ALTER TABLE "SavedList" DROP COLUMN "clientApprovedVersion";
--   ALTER TABLE "SavedList" DROP COLUMN "briefTiming";
--   ALTER TABLE "SavedList" DROP COLUMN "briefText";
