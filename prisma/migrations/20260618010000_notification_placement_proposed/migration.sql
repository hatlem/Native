-- New NotificationKind for the desk acting on a buyer's title placeholder
-- (proposed a concrete placement, or removed a placeholder with no bookable
-- option). Buyer-facing signal back from the "desk proposes a placement" flow.
-- ADD VALUE IF NOT EXISTS is idempotent; the value is only EMITTED by later
-- requests (desk-actions), never inside this migration, so the
-- "can't use a new enum value in the same transaction" rule doesn't apply.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'PLACEMENT_PROPOSED';
