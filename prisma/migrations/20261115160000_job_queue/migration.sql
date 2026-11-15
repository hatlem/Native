-- Durable job queue: idempotent enqueue, worker claims, per-attempt history,
-- a sweep run log and inbound-webhook receipts for replay dedup. Additive.

ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'DISCARDED';

ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "lockedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Job_idempotencyKey_key" ON "Job"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Job_kind_createdAt_idx" ON "Job"("kind", "createdAt");

CREATE TABLE IF NOT EXISTS "JobRun" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "workerId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "ok" BOOLEAN,
  "error" TEXT,
  CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "JobRun_jobId_startedAt_idx" ON "JobRun"("jobId", "startedAt");

CREATE TABLE IF NOT EXISTS "SweepRun" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "via" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3) NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "summary" TEXT NOT NULL,
  CONSTRAINT "SweepRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SweepRun_name_startedAt_idx" ON "SweepRun"("name", "startedAt");

CREATE TABLE IF NOT EXISTS "WebhookReceipt" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookReceipt_provider_eventId_key" ON "WebhookReceipt"("provider", "eventId");
CREATE INDEX IF NOT EXISTS "WebhookReceipt_receivedAt_idx" ON "WebhookReceipt"("receivedAt");
