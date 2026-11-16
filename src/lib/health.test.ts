import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_QUEUE_LAG_MS, evaluateDeepHealth, pendingMigrationNames, type DeepHealthInput } from "./health";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const H = 3_600_000;

function input(over: Partial<DeepHealthInput> = {}): DeepHealthInput {
  return {
    now: NOW,
    db: true,
    pendingMigrations: [],
    failedMigrations: [],
    queue: { pending: 0, running: 0, dead: 0, oldestDueAgeMs: null },
    lastSweepOk: { autosend: ago(0.5 * H), retention: ago(20 * H) },
    ...over,
  };
}

test("everything in order is ok", () => {
  const h = evaluateDeepHealth(input());
  assert.equal(h.status, "ok");
  assert.equal(h.checks.database.status, "ok");
  assert.equal(h.checks["sweep:autosend"].status, "ok");
});

test("a dead database or unapplied migrations fail", () => {
  assert.equal(evaluateDeepHealth(input({ db: false, queue: null })).status, "fail");
  const pending = evaluateDeepHealth(input({ pendingMigrations: ["20261115160000_job_queue"] }));
  assert.equal(pending.status, "fail");
  assert.match(pending.checks.migrations.detail ?? "", /job_queue/);
  assert.equal(evaluateDeepHealth(input({ failedMigrations: ["x"] })).status, "fail");
});

test("an unreadable migrations directory is unknown, not a failure", () => {
  const h = evaluateDeepHealth(input({ pendingMigrations: null }));
  assert.equal(h.checks.migrations.status, "unknown");
  assert.equal(h.status, "ok");
});

test("a stuck queue or dead letters degrade", () => {
  const stuck = evaluateDeepHealth(
    input({ queue: { pending: 4, running: 0, dead: 0, oldestDueAgeMs: MAX_QUEUE_LAG_MS + 1 } }),
  );
  assert.equal(stuck.status, "degraded");
  assert.equal(stuck.checks.jobQueue.status, "degraded");
  const fine = evaluateDeepHealth(input({ queue: { pending: 4, running: 1, dead: 0, oldestDueAgeMs: 30_000 } }));
  assert.equal(fine.status, "ok");
  const dead = evaluateDeepHealth(input({ queue: { pending: 0, running: 0, dead: 2, oldestDueAgeMs: null } }));
  assert.equal(dead.status, "degraded");
  assert.equal(dead.checks.deadLetters.status, "degraded");
});

test("a sweep that has not succeeded recently degrades; one never seen is unknown", () => {
  const stale = evaluateDeepHealth(input({ lastSweepOk: { autosend: ago(4 * H) } }));
  assert.equal(stale.checks["sweep:autosend"].status, "degraded");
  assert.equal(stale.status, "degraded");
  // The daily sweeps are allowed a day and a half.
  assert.equal(evaluateDeepHealth(input({ lastSweepOk: { retention: ago(30 * H) } })).status, "ok");
  assert.equal(evaluateDeepHealth(input({ lastSweepOk: { retention: ago(40 * H) } })).status, "degraded");
  const fresh = evaluateDeepHealth(input({ lastSweepOk: { autosend: null } }));
  assert.equal(fresh.checks["sweep:autosend"].status, "unknown");
  assert.equal(fresh.status, "ok");
});

test("pendingMigrationNames lists what is deployed but not applied", () => {
  assert.deepEqual(pendingMigrationNames(["b", "a", "c"], ["a"]), ["b", "c"]);
  assert.deepEqual(pendingMigrationNames(["a"], ["a", "old"]), []);
});
