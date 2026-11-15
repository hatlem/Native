-- Additive: one row per LLM gateway call, so cost and latency can be
-- attributed per feature and per organisation, and the daily budgets
-- (lib/ai-usage.ts) are counted across every app instance.
-- Reverse with: DROP TABLE "AiCallLog";
CREATE TABLE IF NOT EXISTS "AiCallLog" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCallLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiCallLog_createdAt_idx" ON "AiCallLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AiCallLog_scope_createdAt_idx" ON "AiCallLog"("scope", "createdAt");
