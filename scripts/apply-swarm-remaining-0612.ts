/** Apply the second swarm's verdicts (data/catalog/swarm_remaining_result.json) for
 * the remaining ~96 active `uncertain` titles whose 06-07 notes did NOT flag a
 * hallucination (so they were out of the first 117-sweep). The swarm web-verified
 * each (verify + independent recheck):
 *   - exists=true  (21): real publication → upgrade to LIVE, add corrected name as
 *                        alias, record evidence as verificationSource.
 *   - exists=false (75): no current-publication evidence → deactivate. NOTE these
 *                        split into genuine fakes AND real-but-dormant titles (dead
 *                        domain / last issue years ago), so the note is the honest
 *                        "[UNVERIFIED – no current-publication evidence]" + the
 *                        agent's own reasoning + confidence — not a blanket [FAKE].
 * GUARD: never deactivate a title with an INBOUND contact log.
 * Dry-run by default; --apply to write.
 */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");
const NOW = new Date("2026-06-12T00:00:00.000Z");
const data = JSON.parse(readFileSync("data/catalog/swarm_remaining_result.json", "utf8")) as {
  exists: { id: string; name: string; correctedName?: string; confidence: string; evidence: string; sourceUrl?: string }[];
  deactivate: { id: string; name: string; confidence: string; evidence: string; sourceUrl?: string }[];
};

async function main() {
  let live = 0, deact = 0, guarded = 0, missing = 0, alreadyDead = 0;

  for (const v of data.exists) {
    const t = await prisma.title.findUnique({ where: { id: v.id }, select: { id: true, name: true, aliases: true } });
    if (!t) { missing++; console.log(`  MISSING ${v.name}`); continue; }
    const addAlias = v.correctedName && v.correctedName !== t.name && !t.aliases.includes(v.correctedName) ? [v.correctedName] : [];
    console.log(`  LIVE  ${t.name}${addAlias.length ? "  +alias " + JSON.stringify(addAlias) : ""}`);
    if (APPLY)
      await prisma.title.update({
        where: { id: t.id },
        data: {
          active: true, verificationStatus: "LIVE", lastVerifiedAt: NOW,
          verificationSource: (v.sourceUrl || "swarm-verify") + " | swarm 2026-06-12: " + v.evidence.slice(0, 400),
          ...(addAlias.length ? { aliases: { set: [...t.aliases, ...addAlias] } } : {}),
        },
      });
    live++;
  }

  for (const v of data.deactivate) {
    const t = await prisma.title.findUnique({ where: { id: v.id }, select: { id: true, name: true, discontinuedAt: true } });
    if (!t) { missing++; console.log(`  MISSING ${v.name}`); continue; }
    if (t.discontinuedAt) { alreadyDead++; continue; }
    const inbound = await prisma.contactLog.count({ where: { titleId: t.id, direction: "INBOUND" } });
    if (inbound) { guarded++; console.log(`  GUARDED (has INBOUND reply): ${t.name}`); continue; }
    const note = `[UNVERIFIED – swarm 2026-06-12, ${v.confidence} confidence] No current-publication evidence after web verification + independent recheck (covers both hallucinated entries and real-but-dormant titles). ${v.evidence}`.slice(0, 1000);
    console.log(`  deactivate [${v.confidence}] ${t.name}`);
    if (APPLY)
      await prisma.title.update({
        where: { id: t.id },
        data: { active: false, verificationStatus: "DISCONTINUED", discontinuedAt: NOW, discontinuedNote: note, lastVerifiedAt: NOW, verificationSource: v.sourceUrl || "swarm-verify 2026-06-12" },
      });
    deact++;
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — LIVE: ${live} | deactivated: ${deact} | guarded(INBOUND): ${guarded} | already dead: ${alreadyDead} | missing: ${missing}`);
}
main().finally(() => prisma.$disconnect());
