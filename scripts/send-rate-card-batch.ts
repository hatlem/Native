#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { selectBatchForSend, sendRateCardStep } from "@/lib/outreach/campaign";

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : parseInt(process.env.OUTREACH_DAILY_CAP ?? "20", 10);
  const dryRun = process.argv.includes("--dry-run");

  const operator = await prisma.user.findFirstOrThrow({ where: { role: "SUPERADMIN" } });
  const batch = await selectBatchForSend({ limit });

  console.log(`[send] selected ${batch.length} requests (limit=${limit}, dry-run=${dryRun})`);

  let sent = 0;
  const skipped: Record<string, number> = {};
  for (const r of batch) {
    if (dryRun) {
      console.log(`  - ${r.recipientEmail} sentCount=${r.sentCount} -> would-send`);
      continue;
    }
    const result = await sendRateCardStep({ requestId: r.id, actorId: operator.id });
    if ("sent" in result) {
      sent++;
      console.log(`  ✓ ${r.recipientEmail} (${result.sent})`);
    } else {
      skipped[result.skipped] = (skipped[result.skipped] ?? 0) + 1;
      console.log(`  - ${r.recipientEmail} skipped: ${result.skipped}`);
      if (result.skipped === "rate_limited") break; // abort batch
    }
  }

  console.log(`\n[send] done. sent=${sent} skipped=${JSON.stringify(skipped)}`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
