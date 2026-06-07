/** Sync the 2026-06-06 online audit (outreach_online_audit_0606.json) to the catalog.
 * - killed (dead/merged)       -> deactivate (discontinuedAt + sourced note, DISCONTINUED);
 *                                 merged: old name added to the survivor's aliases when it exists
 * - renamed                    -> rename title to current name, old name -> aliases, stamp LIVE;
 *                                 if a title with the new name already exists -> fold old record
 *                                 as DUPLICATE into the survivor (alias preserved)
 * - quarantined uncertain      -> verificationStatus UNCERTAIN + outstandingInfo (left active)
 * - quarantined wrong-publisher -> outstandingInfo contact-mismatch note (status untouched)
 * - alive                      -> stamp LIVE + evidence URL + lastVerifiedAt (active titles only)
 * GUARD: never deactivates a title with an INBOUND contact log — publisher replies override
 * automated verification (Park & Anlegg / Samtiden lesson).
 * Matches by (countryCode, name) case-insensitively. Dry-run by default; pass --apply to write.
 * Run: railway run --service Postgres sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm tsx scripts/apply-online-audit-db-0606.ts --apply' */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");
const NOW = new Date("2026-06-06T23:00:00.000Z");
const TAG = "online-audit 2026-06-06";

type Killed = { market: string; group: string; title: string; status: string; becameTitle: string | null; note: string; evidence: string | null };
type Renamed = { market: string; group: string; from: string; to: string; note: string; evidence: string | null };
type TQuar = { market: string; group: string; title: string; status: string; note: string; evidence?: string | null };
const audit = JSON.parse(readFileSync("outreach_online_audit_0606.json", "utf8"));
const killed: Killed[] = audit.killed;
const renamed: Renamed[] = audit.renamed;
const titleQuarantine: TQuar[] = audit.titleQuarantine;

// titles catalogued under a different market than their send-list group
// (NEVER fall back to any-market matching — Båtliv exists in both NO and SE)
const MARKET_OVERRIDES: Record<string, string> = { "Landfreund|DE": "CH" };
const mk = (market: string, name: string) => MARKET_OVERRIDES[`${name}|${market}`] ?? market;

const src = (evidence: string | null | undefined, note: string) =>
  evidence || (note.match(/https?:\/\/[^\s)\]]+/) || [])[0] || note.slice(0, 240);

const findTitle = (market: string, name: string) =>
  prisma.title.findFirst({
    where: { countryCode: mk(market, name), name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, aliases: true, discontinuedAt: true, verificationStatus: true, outstandingInfo: true },
  });

async function main() {
  const unmatched: string[] = [];
  let deactivated = 0, renames = 0, folded = 0, flaggedUncertain = 0, flaggedMismatch = 0, stampedLive = 0, guarded = 0;

  // --- 1. dead / merged -> deactivate ---
  for (const k of killed) {
    const t = await findTitle(k.market, k.title);
    if (!t) { unmatched.push(`kill: ${k.title} [${k.market}]`); continue; }
    if (t.discontinuedAt) { console.log(`  already discontinued: ${t.name} (${k.market})`); continue; }
    const inbound = await prisma.contactLog.count({ where: { titleId: t.id, direction: "INBOUND" } });
    if (inbound) { guarded++; console.log(`  GUARDED (has INBOUND reply, not deactivating): ${t.name} (${k.market})`); continue; }
    const note = `[${k.status.toUpperCase()} – ${TAG}] ${k.note}${k.becameTitle ? ` → ${k.becameTitle}` : ""}`.slice(0, 1000);
    console.log(`  deactivate [${k.status}] ${t.name} (${k.market})${k.becameTitle ? " → " + k.becameTitle : ""}`);
    if (APPLY) {
      await prisma.title.update({
        where: { id: t.id },
        data: { discontinuedAt: NOW, discontinuedNote: note, verificationStatus: "DISCONTINUED", verificationSource: src(k.evidence, k.note), lastVerifiedAt: NOW },
      });
    }
    deactivated++;
    // merged: record the old name as an alias on the surviving title when we have it
    if (k.status === "merged" && k.becameTitle) {
      const survivorName = k.becameTitle.replace(/\s*\(.*\)$/, "").trim();
      const s = await findTitle(k.market, survivorName);
      if (s && !s.aliases.some((a) => a.toLowerCase() === k.title.toLowerCase())) {
        console.log(`    + alias "${k.title}" on survivor ${s.name}`);
        if (APPLY) await prisma.title.update({ where: { id: s.id }, data: { aliases: { set: [...s.aliases, k.title] } } });
      }
    }
  }

  // --- 2. renamed -> rename in place, or fold into existing survivor ---
  for (const r of renamed) {
    const oldT = await findTitle(r.market, r.from);
    if (!oldT) { unmatched.push(`rename: ${r.from} [${r.market}]`); continue; }
    const newName = r.to.replace(/\s*\(.*\)$/, "").trim();
    const existing = await findTitle(r.market, newName);
    if (existing && existing.id !== oldT.id) {
      // survivor already in catalog -> old record is a duplicate of it
      console.log(`  fold duplicate: ${oldT.name} -> existing ${existing.name} (${r.market})`);
      if (APPLY) {
        if (!existing.aliases.some((a) => a.toLowerCase() === r.from.toLowerCase()))
          await prisma.title.update({ where: { id: existing.id }, data: { aliases: { set: [...existing.aliases, r.from] } } });
        if (!oldT.discontinuedAt)
          await prisma.title.update({
            where: { id: oldT.id },
            data: { discontinuedAt: NOW, discontinuedNote: `[DUPLICATE – ${TAG}] renamed to ${newName}; survivor kept. ${r.note}`.slice(0, 1000), verificationStatus: "DISCONTINUED", verificationSource: src(r.evidence, r.note), lastVerifiedAt: NOW },
          });
      }
      folded++;
    } else {
      console.log(`  rename: ${oldT.name} -> ${newName} (${r.market})`);
      if (APPLY) {
        const aliases = oldT.aliases.some((a) => a.toLowerCase() === r.from.toLowerCase()) ? oldT.aliases : [...oldT.aliases, r.from];
        await prisma.title.update({
          where: { id: oldT.id },
          data: { name: newName, aliases: { set: aliases }, verificationStatus: "LIVE", verificationSource: src(r.evidence, r.note), lastVerifiedAt: NOW },
        });
      }
      renames++;
    }
  }

  // --- 3. quarantined titles -> UNCERTAIN / contact-mismatch flags ---
  for (const q of titleQuarantine) {
    const t = await findTitle(q.market, q.title);
    if (!t) { unmatched.push(`quarantine: ${q.title} [${q.market}]`); continue; }
    if (t.discontinuedAt) continue;
    if (q.status === "wrong-publisher") {
      const flag = `Kontakt-mismatch (${TAG}): tilhører ikke ${q.group} — ${q.note}`.slice(0, 300);
      console.log(`  flag [contact-mismatch] ${t.name} (${q.market})`);
      if (APPLY && !t.outstandingInfo.includes(flag))
        await prisma.title.update({ where: { id: t.id }, data: { outstandingInfo: { set: [...t.outstandingInfo, flag] } } });
      flaggedMismatch++;
    } else {
      const flag = `USIKKER eksistens (${TAG}): ${q.note}`.slice(0, 300);
      console.log(`  flag [uncertain] ${t.name} (${q.market})`);
      if (APPLY)
        await prisma.title.update({
          where: { id: t.id },
          data: { outstandingInfo: { set: t.outstandingInfo.includes(flag) ? t.outstandingInfo : [...t.outstandingInfo, flag] }, verificationStatus: "UNCERTAIN", verificationSource: src(q.evidence, q.note), lastVerifiedAt: NOW },
        });
      flaggedUncertain++;
    }
  }

  // --- 4. alive -> stamp LIVE with evidence (active titles only, never un-discontinue) ---
  for (const r of audit.verdicts) {
    for (const t of r.verdict?.titles ?? []) {
      if (t.status !== "alive") continue;
      if (titleQuarantine.some((q) => q.group === r.input.email && q.title.toLowerCase() === t.name.toLowerCase())) continue;
      if (APPLY) {
        const u = await prisma.title.updateMany({
          where: { countryCode: r.input.market, name: { equals: t.name, mode: "insensitive" }, discontinuedAt: null },
          data: { verificationStatus: "LIVE", verificationSource: src(t.evidenceUrl, t.note), lastVerifiedAt: NOW },
        });
        stampedLive += u.count;
      } else stampedLive++;
    }
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — deactivated: ${deactivated} | renamed: ${renames} | folded dups: ${folded} | uncertain: ${flaggedUncertain} | contact-mismatch: ${flaggedMismatch} | LIVE-stamped: ${stampedLive}${APPLY ? "" : " (pre-match)"} | guarded: ${guarded} | unmatched: ${unmatched.length}`);
  if (unmatched.length) console.log("UNMATCHED:\n  " + unmatched.join("\n  "));
  if (APPLY) {
    const byVer = await prisma.title.groupBy({ by: ["verificationStatus"], _count: true });
    console.log("by verificationStatus:", JSON.stringify(byVer.map((v) => ({ s: v.verificationStatus, n: v._count }))));
  }
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
