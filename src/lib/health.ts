// What "healthy" means beyond "the database answers", as a pure function so
// the thresholds are pinned by tests. Read by GET /api/health/deep.
import type { SweepName } from "@/lib/sweeps";

export type DeepHealthInput = {
  now: Date;
  db: boolean;
  // Migration names present in the deployed code but not applied; null when
  // the migrations directory cannot be read in this environment.
  pendingMigrations: string[] | null;
  // Migrations that started and never finished (a failed deploy).
  failedMigrations: string[];
  queue: { pending: number; running: number; dead: number; oldestDueAgeMs: number | null } | null;
  // Last successful run per enabled sweep; null = never recorded.
  lastSweepOk: Partial<Record<SweepName, Date | null>>;
};

export type CheckStatus = "ok" | "degraded" | "fail" | "unknown";
export type DeepHealth = {
  status: "ok" | "degraded" | "fail";
  checks: Record<string, { status: CheckStatus; detail?: string }>;
};

// A due job waiting longer than this means no worker is draining the queue.
export const MAX_QUEUE_LAG_MS = 15 * 60_000;
// Hourly sweeps get three ticks of slack; the once-a-day ones a day and a half.
export const SWEEP_MAX_AGE_MS: Record<SweepName, number> = {
  autosend: 3 * 60 * 60_000,
  "price-bands": 3 * 60 * 60_000,
  "placement-ready": 3 * 60 * 60_000,
  metrics: 36 * 60 * 60_000,
  retention: 36 * 60 * 60_000,
};

export function evaluateDeepHealth(i: DeepHealthInput): DeepHealth {
  const checks: DeepHealth["checks"] = {};

  checks.database = i.db ? { status: "ok" } : { status: "fail", detail: "query failed" };

  if (i.failedMigrations.length > 0) {
    checks.migrations = { status: "fail", detail: `failed: ${i.failedMigrations.join(", ")}` };
  } else if (i.pendingMigrations === null) {
    checks.migrations = { status: "unknown", detail: "migrations directory not readable" };
  } else if (i.pendingMigrations.length > 0) {
    // Code that expects a schema the database does not have yet.
    checks.migrations = { status: "fail", detail: `pending: ${i.pendingMigrations.join(", ")}` };
  } else {
    checks.migrations = { status: "ok" };
  }

  if (!i.queue) {
    checks.jobQueue = { status: i.db ? "unknown" : "fail", detail: "could not read the queue" };
    checks.deadLetters = { status: "unknown" };
  } else {
    const lag = i.queue.oldestDueAgeMs;
    checks.jobQueue =
      lag !== null && lag > MAX_QUEUE_LAG_MS
        ? { status: "degraded", detail: `oldest due job has waited ${Math.round(lag / 60_000)} min (pending ${i.queue.pending})` }
        : { status: "ok", detail: `pending ${i.queue.pending}, running ${i.queue.running}` };
    checks.deadLetters =
      i.queue.dead > 0
        ? { status: "degraded", detail: `${i.queue.dead} dead-lettered job(s) — see /desk/jobs` }
        : { status: "ok" };
  }

  for (const [name, last] of Object.entries(i.lastSweepOk) as [SweepName, Date | null][]) {
    const key = `sweep:${name}`;
    if (!last) {
      // A fresh deployment has no history yet; not an alarm on its own.
      checks[key] = { status: "unknown", detail: "no successful run recorded" };
      continue;
    }
    const age = i.now.getTime() - last.getTime();
    checks[key] =
      age > SWEEP_MAX_AGE_MS[name]
        ? { status: "degraded", detail: `last success ${Math.round(age / 3_600_000)} h ago` }
        : { status: "ok", detail: `last success ${Math.round(age / 60_000)} min ago` };
  }

  const all = Object.values(checks).map((c) => c.status);
  const status = all.includes("fail") ? "fail" : all.includes("degraded") ? "degraded" : "ok";
  return { status, checks };
}

// Names in `available` (the deployed migrations) that are not in `applied`.
export function pendingMigrationNames(available: string[], applied: string[]): string[] {
  const done = new Set(applied);
  return available.filter((n) => !done.has(n)).sort();
}
