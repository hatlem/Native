-- TOTP two-factor authentication (additive; reverse with the DROPs below).
--   ALTER TABLE "User" DROP COLUMN "mfaSecretEnc", DROP COLUMN "mfaEnabledAt", DROP COLUMN "mfaLastStep";
--   DROP TABLE "MfaRecoveryCode";
ALTER TABLE "User" ADD COLUMN "mfaSecretEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "mfaEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "mfaLastStep" INTEGER;

CREATE TABLE "MfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MfaRecoveryCode_codeHash_key" ON "MfaRecoveryCode"("codeHash");
CREATE INDEX "MfaRecoveryCode_userId_idx" ON "MfaRecoveryCode"("userId");

ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
