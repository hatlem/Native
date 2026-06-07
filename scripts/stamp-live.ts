/** Stamp verificationStatus=LIVE + source on every title an agent confirmed "real".
 * Reads /tmp/all_verdicts.json (recovered from transcripts) and resolves each
 * verdict's market via the group email (verify_input.json). Only touches active
 * (non-discontinued) titles; never overrides a DISCONTINUED verdict. */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const NOW = new Date("2026-06-05T12:30:00.000Z");
const verdicts: { email: string; title: string; status: string; note: string }[] = JSON.parse(readFileSync("/tmp/all_verdicts.json", "utf8"));
const groups: { email: string; market: string }[] = JSON.parse(readFileSync("/tmp/verify_input.json", "utf8"));
const wave1: { email: string; market: string }[] = JSON.parse(readFileSync("/tmp/wave1_slim.json", "utf8"));
const market = new Map([...groups, ...wave1].map((g) => [g.email.toLowerCase(), g.market]));

async function main() {
  const live = verdicts.filter((v) => v.status === "real");
  let stamped = 0, skipped = 0;
  for (const v of live) {
    const mk = market.get(v.email.toLowerCase());
    if (!mk) { skipped++; continue; }
    const src = (v.note.match(/https?:\/\/[^\s)]+/) || [])[0] || v.note.slice(0, 240);
    const r = await prisma.title.updateMany({
      where: { countryCode: mk, name: { equals: v.title, mode: "insensitive" }, discontinuedAt: null },
      data: { verificationStatus: "LIVE", verificationSource: src, lastVerifiedAt: NOW },
    });
    if (r.count) stamped += r.count; else skipped++;
  }
  console.log(`LIVE stamped: ${stamped} | unmatched/skipped: ${skipped}`);
  const byVer = await prisma.title.groupBy({ by: ["verificationStatus"], _count: true });
  console.log("by verificationStatus:", JSON.stringify(byVer.map((v) => ({ s: v.verificationStatus, n: v._count }))));
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
