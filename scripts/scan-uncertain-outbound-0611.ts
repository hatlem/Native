/** Read-only: for the NEEDS_MAIL_CHECK candidates, how many did we ever email?
 * A publisher reply can only exist where we sent OUTBOUND, so this scopes the
 * Outlook cross-check. Prints contacted (reply possible) vs never-contacted. */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const ev = JSON.parse(readFileSync("data/catalog/uncertain_evidence_0611.json", "utf8"));
const cands: { id: string; name: string; market: string; hallucinationNote: boolean }[] = ev.needsMail;

async function main() {
  const contacted: any[] = [];
  const never: any[] = [];
  for (const c of cands) {
    const out = await prisma.contactLog.count({ where: { titleId: c.id, direction: "OUTBOUND" } });
    (out ? contacted : never).push({ ...c, outbound: out });
  }
  console.log(`candidates: ${cands.length}`);
  console.log(`  contacted (reply possible, worth a mail check): ${contacted.length}`);
  console.log(`  never contacted (no reply can exist): ${never.length}  (hallucination-flagged: ${never.filter((r) => r.hallucinationNote).length})`);
  console.log(`\n--- contacted (check these in Outlook) ---`);
  contacted.forEach((r) => console.log(`  ${r.name} (${r.market})  outbound:${r.outbound}${r.hallucinationNote ? "  ⚑" : ""}`));
}
main().finally(() => prisma.$disconnect());
