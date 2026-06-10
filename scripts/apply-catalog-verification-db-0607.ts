/** Sync the 2026-06-07 catalog verification (data/catalog/catalog_verification_0607.json) to the DB.
 * Covers every title that was UNCERTAIN/UNVERIFIED — verdicts are matched by title ID
 * (echoed by the verification agents), never by name.
 * - alive    -> verificationStatus LIVE + evidence URL + lastVerifiedAt;
 *               fills websiteUrl ONLY where the catalog had none
 * - dead/merged -> deactivate (discontinuedAt + sourced note, DISCONTINUED);
 *               merged: old name aliased onto the survivor when it exists in-market
 * - renamed  -> rename in place (old name -> aliases, LIVE); folds into an existing
 *               survivor as DUPLICATE when the new name is already catalogued
 * - uncertain -> stays UNCERTAIN with the fresh note + lastVerifiedAt
 * GUARD: never deactivates a title with an INBOUND contact log — publisher replies
 * override automated verification.
 * Dry-run by default; pass --apply to write.
 * Run: railway run --service Postgres sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm tsx scripts/apply-catalog-verification-db-0607.ts --apply' */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");
const NOW = new Date("2026-06-07T12:00:00.000Z");
const TAG = "catalog-verification 2026-06-07";

type Verdict = { id: string; name: string; market: string; status: string; currentName: string | null; evidenceUrl: string | null; websiteUrl: string | null; note: string };
const { verdicts }: { verdicts: Verdict[] } = JSON.parse(readFileSync("data/catalog/catalog_verification_0607.json", "utf8"));

const src = (v: Verdict) => v.evidenceUrl || (v.note.match(/https?:\/\/[^\s)\]]+/) || [])[0] || v.note.slice(0, 240);
const cleanName = (s: string) => s.replace(/\s*\(.*\)$/, "").trim();

async function main() {
  const missing: string[] = [];
  let live = 0, urlsFilled = 0, deactivated = 0, renames = 0, folded = 0, uncertain = 0, guarded = 0;

  for (const v of verdicts) {
    const t = await prisma.title.findUnique({
      where: { id: v.id },
      select: { id: true, name: true, aliases: true, websiteUrl: true, discontinuedAt: true, outstandingInfo: true },
    });
    if (!t) { missing.push(`${v.name} (${v.id})`); continue; }
    if (t.discontinuedAt) continue; // settled since export

    if (v.status === "alive") {
      const fillUrl = !t.websiteUrl && v.websiteUrl ? v.websiteUrl : undefined;
      if (fillUrl) urlsFilled++;
      if (APPLY)
        await prisma.title.update({
          where: { id: t.id },
          data: { verificationStatus: "LIVE", verificationSource: src(v), lastVerifiedAt: NOW, ...(fillUrl ? { websiteUrl: fillUrl } : {}) },
        });
      live++;
      continue;
    }

    if (v.status === "dead" || v.status === "merged") {
      const inbound = await prisma.contactLog.count({ where: { titleId: t.id, direction: "INBOUND" } });
      if (inbound) { guarded++; console.log(`  GUARDED (has INBOUND reply, not deactivating): ${t.name} (${v.market})`); continue; }
      console.log(`  deactivate [${v.status}] ${t.name} (${v.market})${v.currentName ? " → " + v.currentName : ""}`);
      if (APPLY)
        await prisma.title.update({
          where: { id: t.id },
          data: {
            discontinuedAt: NOW,
            discontinuedNote: `[${v.status.toUpperCase()} – ${TAG}] ${v.note}${v.currentName ? ` → ${v.currentName}` : ""}`.slice(0, 1000),
            verificationStatus: "DISCONTINUED", verificationSource: src(v), lastVerifiedAt: NOW,
          },
        });
      deactivated++;
      if (v.status === "merged" && v.currentName) {
        const s = await prisma.title.findFirst({
          where: { countryCode: v.market, name: { equals: cleanName(v.currentName), mode: "insensitive" }, id: { not: t.id } },
          select: { id: true, name: true, aliases: true },
        });
        if (s && !s.aliases.some((a) => a.toLowerCase() === v.name.toLowerCase())) {
          console.log(`    + alias "${v.name}" on survivor ${s.name}`);
          if (APPLY) await prisma.title.update({ where: { id: s.id }, data: { aliases: { set: [...s.aliases, v.name] } } });
        }
      }
      continue;
    }

    if (v.status === "renamed" && v.currentName) {
      const newName = cleanName(v.currentName);
      const existing = await prisma.title.findFirst({
        where: { countryCode: v.market, name: { equals: newName, mode: "insensitive" }, id: { not: t.id } },
        select: { id: true, name: true, aliases: true },
      });
      if (existing) {
        console.log(`  fold duplicate: ${t.name} -> existing ${existing.name} (${v.market})`);
        if (APPLY) {
          if (!existing.aliases.some((a) => a.toLowerCase() === v.name.toLowerCase()))
            await prisma.title.update({ where: { id: existing.id }, data: { aliases: { set: [...existing.aliases, v.name] } } });
          await prisma.title.update({
            where: { id: t.id },
            data: { discontinuedAt: NOW, discontinuedNote: `[DUPLICATE – ${TAG}] renamed to ${newName}; survivor kept. ${v.note}`.slice(0, 1000), verificationStatus: "DISCONTINUED", verificationSource: src(v), lastVerifiedAt: NOW },
          });
        }
        folded++;
      } else {
        console.log(`  rename: ${t.name} -> ${newName} (${v.market})`);
        if (APPLY) {
          const aliases = t.aliases.some((a) => a.toLowerCase() === v.name.toLowerCase()) ? t.aliases : [...t.aliases, v.name];
          await prisma.title.update({
            where: { id: t.id },
            data: { name: newName, aliases: { set: aliases }, verificationStatus: "LIVE", verificationSource: src(v), lastVerifiedAt: NOW, ...(!t.websiteUrl && v.websiteUrl ? { websiteUrl: v.websiteUrl } : {}) },
          });
        }
        renames++;
      }
      continue;
    }

    // uncertain (or renamed without a target name)
    const flag = `USIKKER eksistens (${TAG}): ${v.note}`.slice(0, 300);
    if (APPLY)
      await prisma.title.update({
        where: { id: t.id },
        data: {
          outstandingInfo: { set: t.outstandingInfo.includes(flag) ? t.outstandingInfo : [...t.outstandingInfo, flag] },
          verificationStatus: "UNCERTAIN", verificationSource: src(v), lastVerifiedAt: NOW,
        },
      });
    uncertain++;
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — LIVE: ${live} (urls filled: ${urlsFilled}) | deactivated: ${deactivated} | renamed: ${renames} | folded dups: ${folded} | uncertain: ${uncertain} | guarded: ${guarded} | missing ids: ${missing.length}`);
  if (missing.length) console.log("MISSING:\n  " + missing.join("\n  "));
  if (APPLY) {
    const byVer = await prisma.title.groupBy({ by: ["verificationStatus"], _count: true });
    console.log("by verificationStatus:", JSON.stringify(byVer.map((x) => ({ s: x.verificationStatus, n: x._count }))));
  }
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
