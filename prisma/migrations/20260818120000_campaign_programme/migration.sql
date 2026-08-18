-- Campaign programmes (multi-wave planning) + plan-item schedule snapshot +
-- ORDER_COMPLETED notification kind. Purely additive.

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'ORDER_COMPLETED';

-- AlterTable: snapshot of the buyer's per-line flight at submit
ALTER TABLE "PlanItem" ADD COLUMN "scheduleStart" TIMESTAMP(3),
                       ADD COLUMN "scheduleUnits" INTEGER;

-- CreateTable
CREATE TABLE "CampaignProgramme" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plannedWaves" INTEGER NOT NULL,
    "spacingWeeks" INTEGER NOT NULL,
    "rationaleKey" TEXT,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignProgramme_organizationId_archivedAt_idx" ON "CampaignProgramme"("organizationId", "archivedAt");

-- AddForeignKey
ALTER TABLE "CampaignProgramme" ADD CONSTRAINT "CampaignProgramme_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: wave membership
ALTER TABLE "SavedList" ADD COLUMN "programmeId" TEXT,
                        ADD COLUMN "waveNumber" INTEGER,
                        ADD COLUMN "articleAngle" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SavedList_programmeId_waveNumber_key" ON "SavedList"("programmeId", "waveNumber");

-- AddForeignKey
ALTER TABLE "SavedList" ADD CONSTRAINT "SavedList_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "CampaignProgramme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
