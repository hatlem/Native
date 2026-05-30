/*
  Warnings:

  - A unique constraint covering the columns `[confirmTokenHash]` on the table `Subscriber` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Subscriber_confirmTokenHash_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_confirmTokenHash_key" ON "Subscriber"("confirmTokenHash");
