-- AlterTable
ALTER TABLE "User" ADD COLUMN     "publisherId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
