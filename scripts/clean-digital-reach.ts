// Post-process the StatShow crawl results. StatShow returns a
// universal "30 monthly visitors / 30 pageviews / $0.30 revenue"
// placeholder when it has no real data for a domain — confirmed by
// probing both real low-traffic sites and synthesized nonsense
// domains. Anything at-or-below that floor is noise, not signal.
//
// We null those out so the catalog UI falls back to the honest
// combined-readers label instead of telling a prospect a major
// regional paper has 30 monthly readers.

import { prisma } from "@/lib/prisma";

const PLACEHOLDER_FLOOR = 100;

async function main() {
  // Before
  const before = await prisma.title.groupBy({
    by: ["digitalReach"],
    _count: { id: true },
    where: { digitalReach: { not: null, lte: PLACEHOLDER_FLOOR } },
  });
  const lowCount = before.reduce((a, b) => a + b._count.id, 0);
  console.log(`Titles with digitalReach <= ${PLACEHOLDER_FLOOR}: ${lowCount}`);

  // Null them out
  const res = await prisma.title.updateMany({
    where: { digitalReach: { lte: PLACEHOLDER_FLOOR } },
    data: { digitalReach: null },
  });
  console.log(`Nulled ${res.count} placeholder values.`);

  // Summary by market after
  const titles = await prisma.title.findMany({
    where: { digitalReach: { not: null } },
    select: { digitalReach: true, market: { select: { code: true } } },
  });
  const byMarket: Record<string, number[]> = {};
  for (const t of titles) {
    (byMarket[t.market.code] ??= []).push(t.digitalReach!);
  }
  console.log("\nDistribution of real digitalReach by market:");
  for (const [code, vals] of Object.entries(byMarket).sort()) {
    vals.sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    const max = vals[vals.length - 1];
    console.log(`  ${code} · ${vals.length} titles · median ${med.toLocaleString()} · max ${max.toLocaleString()}`);
  }

  const total = await prisma.title.count();
  const withDigital = await prisma.title.count({ where: { digitalReach: { not: null } } });
  console.log(`\nCoverage: ${withDigital} / ${total} titles have a real digital reach (${Math.round((withDigital / total) * 100)}%)`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
