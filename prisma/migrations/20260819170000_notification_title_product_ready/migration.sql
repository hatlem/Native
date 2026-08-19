-- Placement-ready sweep: nudges the buyer + desk when a placeholder
-- SavedListItem's Title gains a confirmed, bookable Product. Purely
-- informational — never auto-prices the placeholder.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'TITLE_PRODUCT_READY';
