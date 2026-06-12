/** Read-only lookup to scaffold the Aamuset price capture (2026-06-12).
 * Finds the FI market, any publisher matching the TS-Yhtymä / Turun group,
 * and whether Aamuset / Turun Sanomat already exist under any name/alias.
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const fi = await prisma.market.findUnique({ where: { code: "FI" }, select: { id: true, name: true, currency: true } });
  console.log("FI market:", fi);

  const pubs = await prisma.publisher.findMany({
    where: { countryCode: "FI", OR: [{ name: { contains: "Turun", mode: "insensitive" } }, { name: { contains: "TS-", mode: "insensitive" } }, { name: { contains: "Aamuset", mode: "insensitive" } }, { name: { contains: "Tietotarjonta", mode: "insensitive" } }] },
    select: { id: true, name: true },
  });
  console.log("Matching FI publishers:", pubs);

  const titles = await prisma.title.findMany({
    where: { countryCode: "FI", OR: [{ name: { contains: "Aamuset", mode: "insensitive" } }, { name: { contains: "Turun Sanomat", mode: "insensitive" } }, { aliases: { has: "Aamuset" } }, { aliases: { has: "Turun Sanomat" } }] },
    select: { id: true, name: true, slug: true, active: true },
  });
  console.log("Matching FI titles:", titles);

  const fiPubCount = await prisma.publisher.count({ where: { countryCode: "FI" } });
  const fiTitleCount = await prisma.title.count({ where: { countryCode: "FI" } });
  console.log(`FI catalog size — publishers: ${fiPubCount}, titles: ${fiTitleCount}`);
}
main().finally(() => prisma.$disconnect());
