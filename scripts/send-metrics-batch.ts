#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { selectMetricsBatchForSend, sendMetricsRequestStep } from "@/lib/campaign-reporting/campaign";

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : parseInt(process.env.METRICS_DAILY_CAP ?? "30", 10);
  const dryRun = process.argv.includes("--dry-run");
  const operator = await prisma.user.findFirstOrThrow({ where: { role: "SUPERADMIN" } });
  const batch = await selectMetricsBatchForSend({ limit });
  console.log(`[metrics-send] selected ${batch.length} (limit=${limit} dry-run=${dryRun})`);
  let sent = 0; const skipped: Record<string, number> = {};
  for (const r of batch) {
    if (dryRun) { console.log(`  - ${r.recipientEmail} sentCount=${r.sentCount}`); continue; }
    const res = await sendMetricsRequestStep({ requestId: r.id, actorId: operator.id });
    if ("sent" in res) { sent++; console.log(`  ✓ ${r.recipientEmail} (${res.sent})`); }
    else { skipped[res.skipped] = (skipped[res.skipped] ?? 0) + 1; if (res.skipped === "rate_limited") break; }
  }
  console.log(`[metrics-send] sent=${sent} skipped=${JSON.stringify(skipped)}`);
  await prisma.$disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
