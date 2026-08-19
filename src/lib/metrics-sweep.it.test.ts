import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { acquireDailyLatch, runMetricsSweepWithLock } from "./metrics-sweep";

// The scheduling safety net, not the pipeline (buildMetricsCampaign /
// sendMetricsRequestStep have their own coverage): the once-per-day latch
// must hold across runs — a second sweep inside the window may do NOTHING,
// because the batch step emails publishers.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.auditLog.deleteMany({ where: { entity: { startsWith: "MetricsSweep:daily" } } });
});

if (!RUN_DB_IT) {
  test("metrics-sweep integration (skipped — set RUN_DB_IT=1)", { skip: true }, () => {});
} else {
  test("daily latch: first acquire wins, the window blocks, expiry reopens", async () => {
    // Isolate from any real marker rows.
    await prisma.auditLog.deleteMany({ where: { entity: { startsWith: "MetricsSweep:daily" } } });

    const now = new Date("2026-08-19T06:00:00Z");
    assert.equal(await acquireDailyLatch(now), true, "first run of the day acquires");
    assert.equal(await acquireDailyLatch(now), false, "same-instant retry is latched");
    assert.equal(
      await acquireDailyLatch(new Date("2026-08-19T23:00:00Z")),
      false,
      "same UTC day, hours later — still latched",
    );
    assert.equal(
      await acquireDailyLatch(new Date("2026-08-20T06:00:00Z")),
      true,
      "next day reopens",
    );
  });

  test("runMetricsSweepWithLock: latched day reports ran=false and sends nothing", async () => {
    await prisma.auditLog.deleteMany({ where: { entity: { startsWith: "MetricsSweep:daily" } } });
    // Pre-latch "today", then run the full locked sweep: it must bail before
    // build/freeze/send (ran=false, no batch fields).
    const now = new Date("2026-08-21T06:00:00Z");
    assert.equal(await acquireDailyLatch(now), true);
    const res = await runMetricsSweepWithLock(now);
    assert.deepEqual(res, { ran: false });
  });
}
