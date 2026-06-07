/** Apply a verify-titles-wave workflow result to the catalog.
 * - dead / fake / duplicate  -> deactivate the title (discontinuedAt + note)
 * - uncertain                -> flag via outstandingInfo (left active)
 * Matches titles by (countryCode, name) case-insensitively. Market is resolved
 * from the group email via the wave input file. Reports unmatched verdicts.
 * Usage: pnpm tsx scripts/apply-verification.ts <workflow-output.json> <wave-input.json> */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-04T23:15:00.000Z");

const out = JSON.parse(readFileSync(process.argv[2], "utf8"));
const wave: { email: string; market: string }[] = JSON.parse(readFileSync(process.argv[3], "utf8"));
const marketOf = new Map(wave.map((g) => [g.email.toLowerCase(), g.market]));
const problems: { email: string; title: string; status: string; note: string }[] = out.result.problems;

async function main() {
  let deactivated = 0, flagged = 0; const unmatched: string[] = [];
  for (const p of problems) {
    const market = marketOf.get(p.email.toLowerCase());
    if (!market) { unmatched.push(`${p.title} (no market for ${p.email})`); continue; }
    const t = await prisma.title.findFirst({
      where: { countryCode: market, name: { equals: p.title, mode: "insensitive" }, discontinuedAt: null },
      select: { id: true, name: true },
    });
    if (!t) { unmatched.push(`${p.title} [${market}] (${p.status})`); continue; }
    // pull a source URL out of the note when present (for verificationSource)
    const src = (p.note.match(/https?:\/\/[^\s)]+/) || [])[0] || p.note.slice(0, 240);
    if (p.status === "dead" || p.status === "fake" || p.status === "duplicate") {
      await prisma.title.update({
        where: { id: t.id },
        data: {
          discontinuedAt: NOW,
          discontinuedNote: `[${p.status.toUpperCase()} – verifisert 2026-06-04] ${p.note}`.slice(0, 1000),
          verificationStatus: "DISCONTINUED",
          verificationSource: src,
          lastVerifiedAt: NOW,
        },
      });
      deactivated++;
      console.log(`  deactivated [${p.status}] ${t.name} (${market})`);
    } else if (p.status === "uncertain") {
      const cur = await prisma.title.findUnique({ where: { id: t.id }, select: { outstandingInfo: true } });
      await prisma.title.update({
        where: { id: t.id },
        data: {
          outstandingInfo: { set: [...new Set([...(cur?.outstandingInfo ?? []), `USIKKER eksistens (verifisert 2026-06-04): ${p.note}`.slice(0, 300)])] },
          verificationStatus: "UNCERTAIN",
          verificationSource: src,
          lastVerifiedAt: NOW,
        },
      });
      flagged++;
      console.log(`  flagged [uncertain] ${t.name} (${market})`);
    }
  }
  console.log(`\nDeactivated: ${deactivated} | flagged uncertain: ${flagged} | unmatched: ${unmatched.length}`);
  if (unmatched.length) console.log("UNMATCHED:\n  " + unmatched.join("\n  "));
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
