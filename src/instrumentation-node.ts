// In-app job scheduling (autosend + metrics sweeps) for the Node server
// runtime. Split out of instrumentation.ts so the edge/middleware compile of
// the instrumentation hook never sees this module's import graph — it pulls
// node:crypto (campaign-reporting/tokens.ts), which webpack's edge target
// cannot bundle. instrumentation.ts imports us behind a statically-inlined
// NEXT_RUNTIME check, so the edge build dead-code-eliminates the import.

const SWEEP_EVERY_MS = 60 * 60_000;
const BOOT_DELAY_MS = 2 * 60_000; // off the deploy's hot path
const METRICS_OFFSET_MS = 5 * 60_000; // stagger so the two jobs never contend
const PLACEMENT_READY_OFFSET_MS = 10 * 60_000; // stagger clear of autosend (0) and metrics (5min)

export async function startSchedules(): Promise<void> {
  // Dev hot-reload can re-evaluate this module; keep exactly one schedule.
  const g = globalThis as { __sweepsScheduled?: boolean };
  if (g.__sweepsScheduled) return;
  g.__sweepsScheduled = true;

  const schedule = (label: string, offsetMs: number, run: () => Promise<string>) => {
    const tick = async () => {
      try {
        console.log(`[${label}] ${await run()}`);
      } catch (err) {
        // The next tick retries; a crashing sweep must never take the app down.
        console.error(`[${label}] sweep crashed`, err);
      }
    };
    // unref() so the timers never hold a shutting-down process open.
    setTimeout(tick, BOOT_DELAY_MS + offsetMs).unref();
    setInterval(tick, SWEEP_EVERY_MS).unref();
  };

  if (process.env.AUTOSEND_SWEEP !== "0") {
    // Dynamic import so Prisma and the sweep only load in the Node runtime.
    const { runAutoSendSweepWithLock } = await import("@/lib/programme-autosend");
    schedule("autosend", 0, async () => {
      const res = await runAutoSendSweepWithLock();
      return res
        ? `sweep done: sent=${res.sent} skipped=${res.skipped} failed=${res.failed}`
        : "sweep skipped: another instance holds the lock";
    });
  }

  if (process.env.METRICS_SWEEP !== "0") {
    const { runMetricsSweepWithLock } = await import("@/lib/metrics-sweep");
    schedule("metrics", METRICS_OFFSET_MS, async () => {
      const res = await runMetricsSweepWithLock();
      if (!res) return "sweep skipped: another instance holds the lock";
      if (!res.ran) return "sweep skipped: already ran today (latch)";
      return `sweep done: created=${res.built?.requests_created ?? 0} frozen=${res.frozen ?? 0} sent=${res.sent ?? 0} skipped=${JSON.stringify(res.skipped ?? {})}`;
    });
  }

  if (process.env.PLACEMENT_READY_SWEEP !== "0") {
    const { runPlacementReadySweepWithLock } = await import("@/lib/placement-ready-sweep");
    schedule("placement-ready", PLACEMENT_READY_OFFSET_MS, async () => {
      const res = await runPlacementReadySweepWithLock();
      if (!res) return "sweep skipped: another instance holds the lock";
      return `sweep done: notified=${res.notified}`;
    });
  }
}
