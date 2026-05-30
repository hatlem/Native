-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('PENDING', 'CONFIRMED', 'UNSUBSCRIBED');

-- DropIndex
DROP INDEX IF EXISTS "Title_searchTsv_idx";

-- AlterTable
ALTER TABLE "Title" DROP COLUMN IF EXISTS "searchTsv";

-- CreateTable
CREATE TABLE "Subscriber" (
    "email" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "confirmTokenHash" TEXT,
    "confirmExpiresAt" TIMESTAMP(3),
    "unsubTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_unsubTokenHash_key" ON "Subscriber"("unsubTokenHash");

-- CreateIndex
CREATE INDEX "Subscriber_status_idx" ON "Subscriber"("status");

-- CreateIndex
CREATE INDEX "Subscriber_confirmTokenHash_idx" ON "Subscriber"("confirmTokenHash");
