-- Writer pool: freelance writer profiles, language/specialty tags, order
-- writer pools, per-line assignment, and writer invite flow.
-- Hand-authored (migrate dev blocked; no reachable shadow DB in this env).
-- All new columns on existing tables are nullable or have defaults — safe
-- to apply on the live prod DB with zero downtime.

-- CreateEnum: ContentLanguage
DO $$ BEGIN
  CREATE TYPE "ContentLanguage" AS ENUM ('NO', 'SV', 'DA', 'FI', 'DE', 'EN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum: LanguageProficiency
DO $$ BEGIN
  CREATE TYPE "LanguageProficiency" AS ENUM ('NATIVE', 'FLUENT', 'WORKING');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum: ContentTopic
DO $$ BEGIN
  CREATE TYPE "ContentTopic" AS ENUM (
    'FINANCE', 'HEALTH', 'TECH', 'LIFESTYLE', 'B2B',
    'TRAVEL', 'FOOD', 'CULTURE', 'SUSTAINABILITY', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable: WriterProfile
CREATE TABLE IF NOT EXISTS "WriterProfile" (
  "id"                   TEXT            NOT NULL,
  "userId"               TEXT            NOT NULL,
  "bio"                  TEXT,
  "ratePerArticle"       DECIMAL(12,2),
  "ratePerWord"          DECIMAL(12,4),
  "currency"             TEXT,
  "maxActiveAssignments" INTEGER,
  "active"               BOOLEAN         NOT NULL DEFAULT true,
  "portfolioUrl"         TEXT,
  "createdAt"            TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "WriterProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WriterProfile_userId_key"
  ON "WriterProfile"("userId");

-- CreateTable: WriterLanguage
CREATE TABLE IF NOT EXISTS "WriterLanguage" (
  "id"          TEXT                NOT NULL,
  "writerId"    TEXT                NOT NULL,
  "language"    "ContentLanguage"   NOT NULL,
  "proficiency" "LanguageProficiency" NOT NULL DEFAULT 'FLUENT',
  CONSTRAINT "WriterLanguage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WriterLanguage_writerId_language_key"
  ON "WriterLanguage"("writerId", "language");

-- CreateTable: WriterSpecialty
CREATE TABLE IF NOT EXISTS "WriterSpecialty" (
  "id"       TEXT             NOT NULL,
  "writerId" TEXT             NOT NULL,
  "topic"    "ContentTopic"   NOT NULL,
  CONSTRAINT "WriterSpecialty_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WriterSpecialty_writerId_topic_key"
  ON "WriterSpecialty"("writerId", "topic");

-- CreateTable: OrderWriterPool
CREATE TABLE IF NOT EXISTS "OrderWriterPool" (
  "id"        TEXT         NOT NULL,
  "orderId"   TEXT         NOT NULL,
  "writerId"  TEXT         NOT NULL,
  "addedById" TEXT         NOT NULL,
  "addedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderWriterPool_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrderWriterPool_orderId_writerId_key"
  ON "OrderWriterPool"("orderId", "writerId");

CREATE INDEX IF NOT EXISTS "OrderWriterPool_writerId_idx"
  ON "OrderWriterPool"("writerId");

-- CreateTable: WriterInvite
CREATE TABLE IF NOT EXISTS "WriterInvite" (
  "id"              TEXT         NOT NULL,
  "email"           TEXT         NOT NULL,
  "token"           TEXT         NOT NULL,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "claimedAt"       TIMESTAMP(3),
  "claimedByUserId" TEXT,
  "createdBy"       TEXT         NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WriterInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WriterInvite_token_key"
  ON "WriterInvite"("token");

CREATE INDEX IF NOT EXISTS "WriterInvite_email_idx"
  ON "WriterInvite"("email");

-- AlterTable: OrderLine — per-line writer assignment
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "assignedWriterId" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "assignedAt"       TIMESTAMP(3);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "assignedById"     TEXT;

-- AlterTable: ContentAsset — author attribution
ALTER TABLE "ContentAsset" ADD COLUMN IF NOT EXISTS "authorWriterId" TEXT;

-- Foreign keys (guarded for idempotency)

DO $$ BEGIN
  ALTER TABLE "WriterProfile"
    ADD CONSTRAINT "WriterProfile_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "WriterLanguage"
    ADD CONSTRAINT "WriterLanguage_writerId_fkey" FOREIGN KEY ("writerId")
    REFERENCES "WriterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "WriterSpecialty"
    ADD CONSTRAINT "WriterSpecialty_writerId_fkey" FOREIGN KEY ("writerId")
    REFERENCES "WriterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "OrderWriterPool"
    ADD CONSTRAINT "OrderWriterPool_orderId_fkey" FOREIGN KEY ("orderId")
    REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "OrderWriterPool"
    ADD CONSTRAINT "OrderWriterPool_writerId_fkey" FOREIGN KEY ("writerId")
    REFERENCES "WriterProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "OrderLine"
    ADD CONSTRAINT "OrderLine_assignedWriterId_fkey" FOREIGN KEY ("assignedWriterId")
    REFERENCES "WriterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ContentAsset"
    ADD CONSTRAINT "ContentAsset_authorWriterId_fkey" FOREIGN KEY ("authorWriterId")
    REFERENCES "WriterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
