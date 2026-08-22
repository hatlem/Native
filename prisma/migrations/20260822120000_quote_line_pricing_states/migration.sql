-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN "priceOnRequest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "priceSetById" TEXT,
ADD COLUMN "priceSetAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_priceSetById_fkey" FOREIGN KEY ("priceSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
