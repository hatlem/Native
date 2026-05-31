import { prisma } from "@/lib/prisma";
import { parseGeo } from "@/lib/targeting/geo";

async function main() {
  const titles = await prisma.title.findMany({
    where: { locationNote: { not: null }, city: null, region: null },
    select: { id: true, countryCode: true, locationNote: true },
  });

  const perMarket: Record<string, { updated: number; seen: number }> = {};
  let updated = 0;

  for (const t of titles) {
    const m = (perMarket[t.countryCode] ??= { updated: 0, seen: 0 });
    m.seen += 1;
    const { city, region } = parseGeo(t.locationNote, t.countryCode);
    if (city || region) {
      await prisma.title.update({ where: { id: t.id }, data: { city, region } });
      updated += 1;
      m.updated += 1;
    }
  }

  console.log(`Backfill complete: ${updated} titles updated.`);
  console.log("Per market (updated / candidates with locationNote):");
  for (const [mk, v] of Object.entries(perMarket).sort()) {
    console.log(`  ${mk}: ${v.updated} / ${v.seen}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
