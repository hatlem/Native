/** Read-only: locate the UK 4-10 outreach titles in the catalog by name/alias
 * so we can log OUTBOUND contacts and (for Gun Mart) attach a fresh contact. */
import { prisma } from "@/lib/prisma";

const NAMES = [
  "Daily Telegraph", "Telegraph", "Sunday Telegraph",
  "Big Issue",
  "Shropshire Star", "Express & Star", "Express and Star",
  "Kent Messenger", "KentOnline", "Kent Online",
  "HuffPost", "Huffington Post", "BuzzFeed",
  "Gun Mart",
  "Pensions Age", "Charity Times",
];

async function main() {
  for (const n of NAMES) {
    const hits = await prisma.title.findMany({
      where: { countryCode: "UK", OR: [{ name: { contains: n, mode: "insensitive" } }, { aliases: { has: n } }] },
      select: { id: true, name: true, slug: true, active: true },
    });
    console.log(`${n.padEnd(20)} -> ${hits.length ? hits.map((h) => `${h.name} [${h.slug}] ${h.id}${h.active ? "" : " (inactive)"}`).join("; ") : "—"}`);
  }
  const ukCount = await prisma.title.count({ where: { countryCode: "UK" } });
  console.log(`\nUK catalog size: ${ukCount} titles`);
}
main().finally(() => prisma.$disconnect());
