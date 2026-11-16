// DB-backed check of the durable rate-limit store. Self-skips without a
// database, like the other *.it.test.ts suites.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PostgresStore, RateLimiter } from "./rate-limit";
import { prisma } from "./prisma";

const hasDb = !!process.env.DATABASE_URL;
const ns = `it-${Date.now()}`;

after(async () => {
  if (!hasDb) return;
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: `${ns}|` } } });
  await prisma.$disconnect();
});

test("postgres store: capacity, refill and retryAfter match the in-memory limiter", { skip: !hasDb }, async () => {
  const rl = new RateLimiter(2, 2, undefined, new PostgresStore(), ns);
  let t = 1_000_000;
  rl._now = () => t;
  assert.equal((await rl.check("a")).ok, true);
  assert.equal((await rl.check("a")).ok, true);
  const blocked = await rl.check("a");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterMs, 500);
  // another key is untouched
  assert.equal((await rl.check("b")).ok, true);
  t += 1000; // 2 tokens back
  assert.equal((await rl.check("a")).ok, true);
  assert.equal((await rl.check("a")).ok, true);
  assert.equal((await rl.check("a")).ok, false);
});

test("postgres store: a second limiter instance shares the bucket (survives a restart)", { skip: !hasDb }, async () => {
  const first = new RateLimiter(1, 0.001, undefined, new PostgresStore(), ns);
  const second = new RateLimiter(1, 0.001, undefined, new PostgresStore(), ns);
  first._now = second._now = () => 2_000_000;
  assert.equal((await first.check("shared")).ok, true);
  assert.equal((await second.check("shared")).ok, false);
});

test("postgres store: concurrent checks never overspend", { skip: !hasDb }, async () => {
  const rl = new RateLimiter(5, 0.0001, undefined, new PostgresStore(), ns);
  rl._now = () => 3_000_000;
  const results = await Promise.all(Array.from({ length: 20 }, () => rl.check("burst")));
  assert.equal(results.filter((r) => r.ok).length, 5);
});

test("a failing store fails open to the in-memory bucket", async () => {
  const broken = {
    get: () => undefined,
    set: () => {},
    delete: () => {},
    consume: async () => {
      throw new Error("db down");
    },
  };
  const rl = new RateLimiter(1, 0, undefined, broken, ns);
  rl._now = () => 0;
  assert.equal((await rl.check("x")).ok, true);
  assert.equal((await rl.check("x")).ok, false);
});
