#!/usr/bin/env tsx
// Manual runner for the programme auto-send sweep (the hourly job in
// src/instrumentation.ts runs the same code). Safe to run any time: it takes
// the same advisory lock, so it can never double-send against a running app.
import { prisma } from "@/lib/prisma";
import { runAutoSendSweepWithLock } from "@/lib/programme-autosend";

async function main() {
  const res = await runAutoSendSweepWithLock();
  console.log(
    res
      ? `[send-due-waves] sent=${res.sent} skipped=${res.skipped} failed=${res.failed}`
      : "[send-due-waves] lock held by another instance — nothing done",
  );
  await prisma.$disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
