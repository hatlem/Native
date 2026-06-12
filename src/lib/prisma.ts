import { PrismaClient } from "@prisma/client";

// Guard against silently connecting to a LOCAL database. NativeSpin uses the
// production DB only — catalog/pricing writes go through the prod MCP, not
// local Prisma scripts. A repo `.env` pointing at localhost previously let
// `tsx scripts/*.ts` and `pnpm dev` read/write a stale local copy that diverged
// from prod. This throws loudly in dev/manual runs if DATABASE_URL is localhost.
// No-op in production (Railway host is never localhost) and in tests; set
// ALLOW_LOCAL_DB=1 to deliberately opt back into a local DB.
const dbUrl = process.env.DATABASE_URL ?? "";
const isLocalDb = /@(localhost|127\.0\.0\.1|\[?::1\]?)[:/]/.test(dbUrl);
const guarded =
  process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";
if (guarded && isLocalDb && process.env.ALLOW_LOCAL_DB !== "1") {
  throw new Error(
    "Refusing to connect to a LOCAL database — DATABASE_URL points at localhost. " +
      "NativeSpin uses the production database only; catalog changes go through the " +
      "prod MCP (native_* tools), not local Prisma scripts. Set ALLOW_LOCAL_DB=1 to override.",
  );
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
