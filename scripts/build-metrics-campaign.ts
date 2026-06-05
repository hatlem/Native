#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { buildMetricsCampaign, freezeDueCampaigns } from "@/lib/campaign-reporting/campaign";

async function main() {
  const operator = await prisma.user.findFirstOrThrow({ where: { role: "SUPERADMIN" } });
  const built = await buildMetricsCampaign({ createdById: operator.id });
  const frozen = await freezeDueCampaigns({});
  console.log(`[metrics-build] created=${built.requests_created} needsContact=${built.needs_contact} scanned=${built.orders_scanned} frozen=${frozen.frozen}`);
  await prisma.$disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
