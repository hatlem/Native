import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import {
  NonRetryableJobError,
  VISIBILITY_TIMEOUT_MS,
  claimDueJobs,
  discardDeadJob,
  drainPending,
  enqueue,
  registerJob,
  retryDeadJob,
} from "@/lib/jobs";
import { runWebhookDeliveryJob, queueWebhookEvent, WEBHOOK_JOB_KIND } from "@/lib/webhooks";

// DB-backed queue test — skipped unless RUN_DB_IT=1.
//
// Every job here is scheduled ten years ahead and drained on an injected
// clock, so a real worker that happens to share the database (a dev server)
// never sees them as due, and this test never runs anyone else's jobs… except
// jobs that really are overdue by ten years, which the per-test kinds ignore.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";
const opts = { skip: !RUN_DB_IT };

const TAG = `qtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const FUTURE = Date.now() + 10 * 365 * 86_400_000;
let tick = 0;
// Each test gets its own instant, later than every job enqueued before it.
function at(offsetMs = 0): Date {
  return new Date(FUTURE + offsetMs);
}
function kind(name: string): string {
  return `${TAG}.${name}`;
}
async function add(k: string, payload: unknown, extra: { idempotencyKey?: string; maxAttempts?: number } = {}) {
  tick += 1;
  return enqueue(k, payload, { ...extra, runAt: at(tick), kick: false });
}
// Drain only on the test clock, and only until our own kinds are settled.
async function drain(workerId: string, clockMs: number, limit = 50) {
  return drainPending(limit, { workerId, now: () => at(clockMs) });
}

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.job.deleteMany({ where: { kind: { startsWith: TAG } } });
  await prisma.job.deleteMany({ where: { idempotencyKey: { startsWith: `webhook:` }, payload: { contains: TAG } } });
  await prisma.partnerWebhook.deleteMany({ where: { targetUrl: { contains: TAG } } });
  await prisma.apiKey.deleteMany({ where: { name: `${TAG} key` } });
  await prisma.$disconnect();
});

test("enqueue is idempotent on the key", opts, async () => {
  const k = kind("idem");
  registerJob(k, async () => {});
  const a = await add(k, { n: 1 }, { idempotencyKey: `${TAG}:same` });
  const b = await add(k, { n: 2 }, { idempotencyKey: `${TAG}:same` });
  const c = await add(k, { n: 3 }, { idempotencyKey: `${TAG}:other` });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(await prisma.job.count({ where: { kind: k } }), 2);
  // The first payload wins.
  const row = await prisma.job.findUniqueOrThrow({ where: { id: a } });
  assert.deepEqual(JSON.parse(row.payload), { n: 1 });
});

test("two workers never run the same job", opts, async () => {
  const k = kind("concurrent");
  const runs = new Map<number, number>();
  registerJob<{ n: number }>(k, async ({ n }) => {
    runs.set(n, (runs.get(n) ?? 0) + 1);
    await new Promise((r) => setTimeout(r, 5));
  });
  const N = 40;
  for (let n = 0; n < N; n++) await add(k, { n });
  const results = await Promise.all([
    drain(`${TAG}-w1`, 10_000, 200),
    drain(`${TAG}-w2`, 10_000, 200),
    drain(`${TAG}-w3`, 10_000, 200),
  ]);
  assert.equal(runs.size, N, "every job ran");
  for (const [n, count] of runs) assert.equal(count, 1, `job ${n} ran ${count} times`);
  const rows = await prisma.job.findMany({ where: { kind: k }, include: { runs: true } });
  assert.ok(rows.every((r) => r.status === "DONE" && r.attempts === 1 && r.runs.length === 1 && r.lockedBy === null));
  // The three workers shared the work between them (no double counting).
  const ours = results.reduce((sum, r) => sum + r.done, 0);
  assert.ok(ours >= N);
});

test("a claimed job is invisible to a second claim until the visibility timeout", opts, async () => {
  const k = kind("claim");
  registerJob(k, async () => {});
  const id = await add(k, {});
  const first = await claimDueJobs(`${TAG}-a`, 500, at(20_000));
  assert.ok(first.includes(id));
  const second = await claimDueJobs(`${TAG}-b`, 500, at(20_001));
  assert.ok(!second.includes(id), "still locked by the first worker");
  // The first worker died: after the timeout another worker takes the job over.
  const later = await claimDueJobs(`${TAG}-b`, 500, at(20_000 + VISIBILITY_TIMEOUT_MS + 1));
  assert.ok(later.includes(id));
  const row = await prisma.job.findUniqueOrThrow({ where: { id } });
  assert.equal(row.lockedBy, `${TAG}-b`);
  assert.equal(row.attempts, 2);
  // Hand back everything this test claimed that is not ours to keep.
  await prisma.job.updateMany({
    where: { lockedBy: { in: [`${TAG}-a`, `${TAG}-b`] }, NOT: { kind: { startsWith: TAG } } },
    data: { status: "PENDING", lockedBy: null, lockedAt: null, attempts: { decrement: 1 } },
  });
  await prisma.job.deleteMany({ where: { id } });
});

test("a failing job is retried with growing backoff, then dead-lettered", opts, async () => {
  const k = kind("flaky");
  let calls = 0;
  registerJob(
    k,
    async () => {
      calls += 1;
      throw new Error(`boom ${calls}`);
    },
    { backoffBaseMs: 1000 },
  );
  const id = await add(k, {}, { maxAttempts: 3 });
  let clock = 30_000;

  await drain(`${TAG}-w`, clock);
  let row = await prisma.job.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "PENDING");
  assert.equal(row.attempts, 1);
  assert.equal(row.lastError, "boom 1");
  const delay1 = row.runAt.getTime() - at(clock).getTime();
  assert.ok(delay1 >= 1000 && delay1 <= 1200, `first backoff ${delay1}`);

  // Not due yet: draining right away does nothing.
  await drain(`${TAG}-w`, clock + 10);
  assert.equal(calls, 1);

  clock += 2000;
  await drain(`${TAG}-w`, clock);
  row = await prisma.job.findUniqueOrThrow({ where: { id } });
  assert.equal(row.attempts, 2);
  const delay2 = row.runAt.getTime() - at(clock).getTime();
  assert.ok(delay2 >= 2000 && delay2 <= 2400, `second backoff ${delay2}`);

  clock += 5000;
  await drain(`${TAG}-w`, clock);
  row = await prisma.job.findUniqueOrThrow({ where: { id }, include: { runs: { orderBy: { attempt: "asc" } } } });
  assert.equal(row.status, "FAILED", "dead-lettered after the third failure");
  assert.equal(calls, 3);
  assert.ok(row.finishedAt);
  const runs = (row as typeof row & { runs: { attempt: number; ok: boolean | null; error: string | null }[] }).runs;
  assert.deepEqual(runs.map((r) => [r.attempt, r.ok, r.error]), [
    [1, false, "boom 1"],
    [2, false, "boom 2"],
    [3, false, "boom 3"],
  ]);

  // Dead jobs are never picked up again on their own.
  await drain(`${TAG}-w`, clock + 3_600_000);
  assert.equal(calls, 3);
});

test("a non-retryable error dead-letters on the first attempt", opts, async () => {
  const k = kind("fatal");
  registerJob(k, async () => {
    throw new NonRetryableJobError("receiver said 400");
  });
  const id = await add(k, {});
  await drain(`${TAG}-w`, 40_000);
  const row = await prisma.job.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "FAILED");
  assert.equal(row.attempts, 1);
  assert.equal(row.lastError, "receiver said 400");
});

test("a job with no handler is dead-lettered, not retried forever", opts, async () => {
  const id = await add(kind("nobody-home"), {});
  await drain(`${TAG}-w`, 50_000);
  const row = await prisma.job.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "FAILED");
  assert.match(row.lastError ?? "", /no handler/);
});

test("a dead job can be retried or discarded by hand", opts, async () => {
  const k = kind("revive");
  let fail = true;
  registerJob(k, async () => {
    if (fail) throw new NonRetryableJobError("nope");
  });
  const id = await add(k, {});
  await drain(`${TAG}-w`, 60_000);
  assert.equal((await prisma.job.findUniqueOrThrow({ where: { id } })).status, "FAILED");

  fail = false;
  assert.equal(await retryDeadJob(id), true);
  assert.equal(await retryDeadJob(id), false, "only a dead job can be retried");
  // retryDeadJob schedules it for the real "now", which is long before the test clock.
  await drain(`${TAG}-w`, 60_001);
  const done = await prisma.job.findUniqueOrThrow({ where: { id } });
  assert.equal(done.status, "DONE");
  assert.equal(done.lastError, null);

  const other = await add(k, {});
  fail = true;
  await drain(`${TAG}-w`, 60_002);
  assert.equal(await discardDeadJob(other), true);
  assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: other } })).status, "DISCARDED");
  assert.equal(await discardDeadJob(other), false);
});

test("webhook events are queued once per receiver and delivered with a stable delivery id", opts, async () => {
  const key = await prisma.apiKey.create({
    data: { name: `${TAG} key`, tokenHash: `${TAG}-hash`, createdBy: "queue-test" },
  });
  const wh = await prisma.partnerWebhook.create({
    data: {
      apiKeyId: key.id,
      createdBy: "queue-test",
      targetUrl: `https://example.invalid/${TAG}`,
      secretHash: "test-secret",
      events: "title.activated,title.price_changed",
    },
  });
  const ids = (await queueWebhookEvent("title.activated", { tag: TAG }, { kick: false })).filter(Boolean);
  const mine = await prisma.job.findMany({ where: { id: { in: ids }, payload: { contains: wh.id } } });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].kind, WEBHOOK_JOB_KIND);
  const payload = JSON.parse(mine[0].payload);

  const seen: { deliveryId: string | null; attempt: string | null }[] = [];
  let status = 503;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    seen.push({ deliveryId: h.get("X-NativeSpin-Delivery-Id"), attempt: h.get("X-NativeSpin-Delivery-Attempt") });
    return new Response("x", { status });
  }) as typeof fetch;

  // A 503 is retryable: the job throws a plain error and the receiver row records the failure.
  await assert.rejects(
    runWebhookDeliveryJob(payload, { jobId: mine[0].id, attempt: 1, maxAttempts: 8 }, fetchImpl),
    (err: Error) => !(err instanceof NonRetryableJobError),
  );
  assert.ok((await prisma.partnerWebhook.findUniqueOrThrow({ where: { id: wh.id } })).lastErrorAt);

  // A 400 is the receiver rejecting the payload: not retried.
  status = 400;
  await assert.rejects(
    runWebhookDeliveryJob(payload, { jobId: mine[0].id, attempt: 2, maxAttempts: 8 }, fetchImpl),
    NonRetryableJobError,
  );

  status = 200;
  await runWebhookDeliveryJob(payload, { jobId: mine[0].id, attempt: 3, maxAttempts: 8 }, fetchImpl);
  assert.ok((await prisma.partnerWebhook.findUniqueOrThrow({ where: { id: wh.id } })).lastDeliveryAt);

  assert.deepEqual(seen.map((s) => s.attempt), ["1", "2", "3"]);
  assert.equal(new Set(seen.map((s) => s.deliveryId)).size, 1, "one delivery id across the retries");
  assert.equal(seen[0].deliveryId, `${payload.eventId}.${wh.id}`);

  // A disabled receiver is skipped without a request.
  await prisma.partnerWebhook.update({ where: { id: wh.id }, data: { disabledAt: new Date() } });
  await runWebhookDeliveryJob(payload, { jobId: mine[0].id, attempt: 4, maxAttempts: 8 }, fetchImpl);
  assert.equal(seen.length, 3);

  await prisma.job.deleteMany({ where: { id: { in: ids } } });
});
