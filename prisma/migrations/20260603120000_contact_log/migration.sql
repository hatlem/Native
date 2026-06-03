-- Per-title contact log (kontakthistorikk) + attribution from received
-- offers (PriceQuote) back to the contact event. Additive. The PriceQuote
-- link is nullable with ON DELETE SET NULL so applied prices survive a
-- contact-log deletion.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ContactChannel" AS ENUM ('EMAIL', 'PHONE', 'WEB_FORM', 'LINKEDIN', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ContactDirection" AS ENUM ('OUTBOUND', 'INBOUND');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ContactLog" (
  "id" TEXT NOT NULL,
  "titleId" TEXT NOT NULL,
  "salesContactId" TEXT,
  "channel" "ContactChannel" NOT NULL,
  "direction" "ContactDirection" NOT NULL DEFAULT 'OUTBOUND',
  "contactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contactedById" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ContactLog_titleId_idx" ON "ContactLog"("titleId");
CREATE INDEX IF NOT EXISTS "ContactLog_contactedAt_idx" ON "ContactLog"("contactedAt");
CREATE INDEX IF NOT EXISTS "ContactLog_salesContactId_idx" ON "ContactLog"("salesContactId");

-- AlterTable: PriceQuote attribution link
ALTER TABLE "PriceQuote" ADD COLUMN IF NOT EXISTS "contactLogId" TEXT;
CREATE INDEX IF NOT EXISTS "PriceQuote_contactLogId_idx" ON "PriceQuote"("contactLogId");

-- Enums and FKs are guarded for idempotency; older migrations use bare CREATE TYPE/ADD CONSTRAINT.

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "ContactLog"
    ADD CONSTRAINT "ContactLog_titleId_fkey" FOREIGN KEY ("titleId")
    REFERENCES "Title"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ContactLog"
    ADD CONSTRAINT "ContactLog_salesContactId_fkey" FOREIGN KEY ("salesContactId")
    REFERENCES "SalesContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ContactLog"
    ADD CONSTRAINT "ContactLog_contactedById_fkey" FOREIGN KEY ("contactedById")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "PriceQuote"
    ADD CONSTRAINT "PriceQuote_contactLogId_fkey" FOREIGN KEY ("contactLogId")
    REFERENCES "ContactLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
