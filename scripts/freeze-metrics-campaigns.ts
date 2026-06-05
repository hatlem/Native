#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { freezeDueCampaigns } from "@/lib/campaign-reporting/campaign";

async function main() {
  const res = await freezeDueCampaigns({});
  console.log(`[metrics-freeze] frozen=${res.frozen}`);
  await prisma.$disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
