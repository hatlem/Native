-- PriceRequest: tracks a desk-initiated outreach to a sales contact
-- asking them to confirm/supply pricing for a title. Token-gated so
-- the contact can respond via a link without needing an account.
-- PriceResponseSource enum records how the response arrived.

CREATE TYPE "PriceResponseSource" AS ENUM (
  'LINK_FORM',
  'MANUAL_EMAIL',
  'MANUAL_PHONE',
  'MANUAL_OTHER'
);

CREATE TABLE IF NOT EXISTS "PriceRequest" (
  "id"             TEXT          NOT NULL,
  "titleId"        TEXT          NOT NULL,
  "salesContactId" TEXT          NOT NULL,
  "token"          TEXT          NOT NULL,
  "expiresAt"      TIMESTAMP(3)  NOT NULL,
  "sentAt"         TIMESTAMP(3),
  "openedAt"       TIMESTAMP(3),
  "respondedAt"    TIMESTAMP(3),
  "cancelledAt"    TIMESTAMP(3),
  "responseSource" "PriceResponseSource",
  "responseNote"   TEXT,
  "hasNative"      BOOLEAN,
  "requestedById"  TEXT          NOT NULL,
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "PriceRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PriceRequest_token_key"
  ON "PriceRequest"("token");

CREATE INDEX IF NOT EXISTS "PriceRequest_titleId_idx"
  ON "PriceRequest"("titleId");

CREATE INDEX IF NOT EXISTS "PriceRequest_salesContactId_idx"
  ON "PriceRequest"("salesContactId");

CREATE INDEX IF NOT EXISTS "PriceRequest_respondedAt_idx"
  ON "PriceRequest"("respondedAt");

ALTER TABLE "PriceRequest"
  ADD CONSTRAINT "PriceRequest_titleId_fkey"
  FOREIGN KEY ("titleId") REFERENCES "Title"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceRequest"
  ADD CONSTRAINT "PriceRequest_salesContactId_fkey"
  FOREIGN KEY ("salesContactId") REFERENCES "SalesContact"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceRequest"
  ADD CONSTRAINT "PriceRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
