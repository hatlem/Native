-- Buyer asked the desk to renew an expired quote.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'QUOTE_RENEWAL_REQUESTED';
