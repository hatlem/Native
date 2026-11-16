// In-app job scheduling (autosend, metrics, placement-ready and price-band
// sweeps) for the Node server
// runtime. Split out of instrumentation.ts so the edge/middleware compile of
// the instrumentation hook never sees this module's import graph — it pulls
// node:crypto (campaign-reporting/tokens.ts), which webpack's edge target
// cannot bundle. instrumentation.ts imports us behind a statically-inlined
// NEXT_RUNTIME check, so the edge build dead-code-eliminates the import.
//
// The sweeps themselves live in lib/sweeps.ts, shared with the
// /api/cron/sweeps endpoint. Set IN_PROCESS_SWEEPS=0 to turn these timers off
// once an external scheduler (Railway cron) calls that endpoint instead.

const SWEEP_EVERY_MS = 60 * 60_000;
const BOOT_DELAY_MS = 2 * 60_000; // off the deploy's hot path

export async function startSchedules(): Promise<void> {
  // Fail fast on a misconfigured production deploy; warn everywhere else.
  const { validateEnvAtBoot } = await import("@/lib/env");
  validateEnvAtBoot();

  // The durable job queue (lib/jobs) is polled in this process unless
  // JOB_WORKER=0 — independent of the sweep timers, because queued webhook
  // and email retries need a tick every few seconds, not every hour.
  // /api/cron/sweeps drains the queue too.
  if (!(globalThis as { __jobWorkerStarted?: boolean }).__jobWorkerStarted) {
    (globalThis as { __jobWorkerStarted?: boolean }).__jobWorkerStarted = true;
    const { startJobWorker } = await import("@/lib/jobs");
    startJobWorker();
  }

  if (process.env.IN_PROCESS_SWEEPS === "0") return;

  // Dev hot-reload can re-evaluate this module; keep exactly one schedule.
  const g = globalThis as { __sweepsScheduled?: boolean };
  if (g.__sweepsScheduled) return;
  g.__sweepsScheduled = true;

  // Dynamic import so Prisma and the sweeps only load in the Node runtime.
  const { enabledSweeps, runSweep } = await import("@/lib/sweeps");
  for (const def of enabledSweeps()) {
    // runSweep never throws: a crashing sweep must never take the app down,
    // and the next tick retries.
    const tick = () => void runSweep(def, "timer");
    // unref() so the timers never hold a shutting-down process open.
    setTimeout(tick, BOOT_DELAY_MS + def.offsetMs).unref();
    setInterval(tick, SWEEP_EVERY_MS).unref();
  }
}
