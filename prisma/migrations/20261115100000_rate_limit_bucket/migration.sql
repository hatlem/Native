-- Durable token buckets for the rate limiter (src/lib/rate-limit.ts).
-- Additive: one new table, nothing else touched. Rows are small, keyed by
-- "<limiter>|<caller key>", and pruned by the limiter itself once cold.
-- Reverse with: DROP TABLE "RateLimitBucket";
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "updatedMs" DOUBLE PRECISION NOT NULL,
    "lastAllowed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "RateLimitBucket_updatedMs_idx" ON "RateLimitBucket"("updatedMs");
