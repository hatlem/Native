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
  process.env.NODE_ENV !== "production" &&
  process.env.NODE_ENV !== "test" &&
  // node:test sets NODE_TEST_CONTEXT in the runner processes — unit tests
  // import this module transitively without ever touching the DB.
  !process.env.NODE_TEST_CONTEXT;

function assertNotLocal() {
  if (guarded && isLocalDb && process.env.ALLOW_LOCAL_DB !== "1") {
    throw new Error(
      "Refusing to connect to a LOCAL database — DATABASE_URL points at localhost. " +
        "NativeSpin uses the production database only; catalog changes go through the " +
        "prod MCP (native_* tools), not local Prisma scripts. Set ALLOW_LOCAL_DB=1 to override.",
    );
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function buildClient() {
  // Throw at first USE, not at import — modules may import `prisma`
  // for types/transitive reasons without ever querying.
  assertNotLocal();
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

// Lazy proxy: the real client is constructed (and the local-DB guard runs)
// on first property access instead of module load.
export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  (new Proxy({} as PrismaClient, {
    get(_target, prop, receiver) {
      const client = (globalForPrisma.prisma ??= buildClient());
      const value = Reflect.get(client, prop, receiver);
      return typeof value === "function" ? value.bind(client) : value;
    },
  }) as PrismaClient);
// Note: buildClient() memoizes into globalForPrisma on first use, which
// also preserves the dev-HMR single-client behaviour the old module-load
// assignment provided. Assigning the proxy itself there would make the
// proxy resolve to itself and recurse.
