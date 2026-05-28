#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { buildRateCardCampaign } from "@/lib/outreach/campaign";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const operator = await prisma.user.findFirstOrThrow({ where: { role: "SUPERADMIN" } });

  if (dryRun) {
    const contacts = await prisma.salesContact.count();
    const suppressed = await prisma.outreachSuppression.count();
    const existing = await prisma.rateCardRequest.count({ where: { cancelledAt: null, expiresAt: { gt: new Date() } } });
    console.log(`[build] dry-run: ${contacts} sales contacts, ${suppressed} suppressed, ${existing} active requests`);
    await prisma.$disconnect();
    return;
  }

  const result = await buildRateCardCampaign({ createdById: operator.id });
  console.log(`[build] done. created=${result.requests_created} skipped=${result.requests_skipped} titles_covered=${result.titles_covered}`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
