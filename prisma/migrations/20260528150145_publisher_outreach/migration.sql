-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RateCardResponseSource" AS ENUM ('FORM', 'EMAIL');

-- CreateTable
CREATE TABLE "ContactCandidate" (
    "id" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT,
    "phone" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "salesContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardRequest" (
    "id" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "locale" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "lastStepAt" TIMESTAMP(3),
    "nextStepAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "mediaKitUrl" TEXT,
    "mediaKitObjectKey" TEXT,
    "responseNote" TEXT,
    "formatsOffered" TEXT[],
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactRole" TEXT,
    "responseData" JSONB,
    "responseSource" "RateCardResponseSource",
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCardRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardRequestTitle" (
    "rateCardRequestId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,

    CONSTRAINT "RateCardRequestTitle_pkey" PRIMARY KEY ("rateCardRequestId","titleId")
);

-- CreateTable
CREATE TABLE "OutreachSuppression" (
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachSuppression_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactCandidate_publisherId_email_key" ON "ContactCandidate"("publisherId", "email");

-- CreateIndex
CREATE INDEX "ContactCandidate_status_idx" ON "ContactCandidate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RateCardRequest_token_key" ON "RateCardRequest"("token");

-- CreateIndex
CREATE INDEX "RateCardRequest_recipientEmail_idx" ON "RateCardRequest"("recipientEmail");

-- CreateIndex
CREATE INDEX "RateCardRequest_nextStepAt_respondedAt_cancelledAt_idx" ON "RateCardRequest"("nextStepAt", "respondedAt", "cancelledAt");

-- CreateIndex
CREATE INDEX "RateCardRequest_respondedAt_idx" ON "RateCardRequest"("respondedAt");

-- CreateIndex
CREATE INDEX "RateCardRequestTitle_titleId_idx" ON "RateCardRequestTitle"("titleId");

-- AddForeignKey
ALTER TABLE "ContactCandidate" ADD CONSTRAINT "ContactCandidate_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardRequest" ADD CONSTRAINT "RateCardRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardRequestTitle" ADD CONSTRAINT "RateCardRequestTitle_rateCardRequestId_fkey" FOREIGN KEY ("rateCardRequestId") REFERENCES "RateCardRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardRequestTitle" ADD CONSTRAINT "RateCardRequestTitle_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;
