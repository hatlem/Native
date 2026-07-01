-- Campaign flow KYC: buyer business-type + billing block on Organization (all nullable, soft gate).

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('BRAND', 'AGENCY', 'PUBLISHER');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "businessType" "BusinessType";
ALTER TABLE "Organization" ADD COLUMN "legalName" TEXT;
ALTER TABLE "Organization" ADD COLUMN "billingEmail" TEXT;
ALTER TABLE "Organization" ADD COLUMN "addressLine1" TEXT;
ALTER TABLE "Organization" ADD COLUMN "addressLine2" TEXT;
ALTER TABLE "Organization" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "Organization" ADD COLUMN "city" TEXT;
