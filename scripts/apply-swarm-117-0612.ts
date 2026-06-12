/** Apply the subagent-swarm verdicts (data/catalog/swarm_117_result.json) for the
 * 117 hallucination-candidate titles flagged 06-07 as uncertain.
 *
 * The swarm web-verified each title's existence (verify + independent recheck):
 *   - exists=true  (4): real publication found → upgrade to LIVE, add corrected
 *                       name as alias, record the evidence as verificationSource.
 *   - exists=false (113): no existence evidence after search → deactivate
 *                       (discontinuedAt + DISCONTINUED + sourced [FAKE/UNVERIFIED]
 *                       note carrying the agent's reasoning + confidence), exactly
 *                       as the user asked ("if no evidence, deactivate and write
 *                       clearly why").
 *
 * GUARD: never deactivate a title that has an INBOUND contact log (a publisher
 * reply outranks automated verification) — per the catalog data standard.
 * Dry-run by default; --apply to write.
 * Run: railway run --service Postgres sh -c \
 *   'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm tsx scripts/apply-swarm-117-0612.ts --apply'
 */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");
const NOW = new Date("2026-06-12T00:00:00.000Z");
const data = JSON.parse(readFileSync("data/catalog/swarm_117_result.json", "utf8")) as {
  exists: { id: string; name: string; correctedName?: string; confidence: string; evidence: string; sourceUrl?: string }[];
  deactivate: { id: string; name: string; confidence: string; evidence: string; sourceUrl?: string }[];
};

async function main() {
  let live = 0, deact = 0, guarded = 0, missing = 0, alreadyDead = 0;

  // 1) Real titles → LIVE + corrected alias + evidence
  for (const v of data.exists) {
    const t = await prisma.title.findUnique({ where: { id: v.id }, select: { id: true, name: true, aliases: true, active: true } });
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

  // 2) No-evidence titles → deactivate (guard on INBOUND reply)
  for (const v of data.deactivate) {
    const t = await prisma.title.findUnique({ where: { id: v.id }, select: { id: true, name: true, active: true, discontinuedAt: true } });
    if (!t) { missing++; console.log(`  MISSING ${v.name}`); continue; }
    if (t.discontinuedAt) { alreadyDead++; continue; }
    const inbound = await prisma.contactLog.count({ where: { titleId: t.id, direction: "INBOUND" } });
    if (inbound) { guarded++; console.log(`  GUARDED (has INBOUND reply): ${t.name}`); continue; }
    const note = `[FAKE/UNVERIFIED – swarm 2026-06-12, ${v.confidence} confidence] No existence evidence found after web verification + independent recheck. ${v.evidence}`.slice(0, 1000);
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
