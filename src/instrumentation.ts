// Next.js instrumentation hook (stable since Next 15): register() runs once
// per server process at boot. We use it to schedule the programme auto-send
// sweep — no external cron on Railway, and the Postgres advisory lock inside
// runAutoSendSweepWithLock makes concurrent instances safe (only one sweeps).
//
// Opt-out with AUTOSEND_SWEEP=0 (e.g. for one-off maintenance instances);
// scripts/send-due-waves.ts remains the manual runner either way.

const SWEEP_EVERY_MS = 60 * 60_000; // hourly — due-ness moves on a day scale
const BOOT_DELAY_MS = 2 * 60_000; // first run shortly after boot, off the deploy's hot path

export async function register(): Promise<void> {
  // Only the Node.js server runtime — never the edge/middleware bundle
  // (no Prisma there) and never the build.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.AUTOSEND_SWEEP === "0") return;

  // Dev hot-reload can re-evaluate this module; keep exactly one schedule.
  const g = globalThis as { __autosendScheduled?: boolean };
  if (g.__autosendScheduled) return;
  g.__autosendScheduled = true;

  // Dynamic import so Prisma and the sweep only load in the Node runtime.
  const { runAutoSendSweepWithLock } = await import("@/lib/programme-autosend");

  const sweep = async () => {
    try {
      const res = await runAutoSendSweepWithLock();
      console.log(
        res
          ? `[autosend] sweep done: sent=${res.sent} skipped=${res.skipped} failed=${res.failed}`
          : "[autosend] sweep skipped: another instance holds the lock",
      );
    } catch (err) {
      // The next tick retries; a crashing sweep must never take the app down.
      console.error("[autosend] sweep crashed", err);
    }
  };

  // unref() so the timers never hold a shutting-down process open.
  setTimeout(sweep, BOOT_DELAY_MS).unref();
  setInterval(sweep, SWEEP_EVERY_MS).unref();
}
