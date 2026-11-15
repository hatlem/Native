// Scheduler entry point for the background sweeps (autosend, metrics,
// price-bands, placement-ready) — the same registry the in-process timers
// run (lib/sweeps.ts). It exists so the jobs can be driven by an external
// scheduler (Railway cron: `curl -fsS -X POST -H "Authorization: Bearer
// $CRON_SECRET" $APP_URL/api/cron/sweeps`), which survives deploys and
// restarts and leaves a run history, instead of setInterval in the web
// process. Once the cron is live, set IN_PROCESS_SWEEPS=0.
//
// Auth: `Authorization: Bearer <CRON_SECRET>`. With CRON_SECRET unset the
// endpoint answers 404, so it is inert until the owner opts in.
// Optional `?only=autosend,metrics` runs a subset.
//
// Safe to call concurrently with the timers or twice in a row: every sweep
// takes an advisory lock, a daily latch, or is revision-guarded.
import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { enabledSweeps, runSweep, type SweepOutcome } from "@/lib/sweeps";

export const dynamic = "force-dynamic";
// The metrics sweep sends mail in a loop; give the batch room.
export const maxDuration = 300;

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = checkCronAuth(req.headers.get("authorization"));
  if (auth === "disabled") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (auth === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const only = (req.nextUrl.searchParams.get("only") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defs = enabledSweeps().filter((d) => only.length === 0 || only.includes(d.name));

  // Sequential: the sweeps were staggered on purpose so they never contend.
  const results: SweepOutcome[] = [];
  for (const def of defs) results.push(await runSweep(def, "cron"));

  const ok = results.every((r) => r.ok);
  // 500 on any failure so the scheduler's own run history shows it red.
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
