/** 2026-06-10: log the 4 question-replies I sent (2nd-day wave) as OUTBOUND. Dup-guarded. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const TAG = "reply 2026-06-10 (question-answer)";
const ACKS: { slug: string; to: string; note: string }[] = [
  { slug: "dagens-medicin-se", to: "christine.stenback@dagensmedicin.se", note: "Svarte Christine på målgrupp/syfte: vårdprofession/beslutsfattare inom hälsa, redaktionellt anpassat innehåll (ej display), test/pilot först; konkret kund efter sommaren." },
  { slug: "fyens-stiftstidende-dk", to: "lam@jfm.dk", note: "Svarte Lars Maiborg (JFM): det er NATIVE artikler (ikke link building); bad om prisliste for native på tværs af Fyens Stiftstidende/JydskeVestkysten/Århus Stiftstidende m.fl." },
  { slug: "dagens-n-ringsliv-no", to: "anette.johansen@dngroup.com", note: "Svarte Anette (DN/D2): fullbooket på tlf denne uken, foreslo å ta det på e-post; ba om prisoversikt for native/annonsørinnhold; tilbød kort prat neste uke." },
  { slug: "forskning-no-no", to: "kristin.j@forskning.no", note: "Svarte Kristin (Forskning.no): fullbooket denne uken, kommer tilbake tidlig neste uke for Teams-møte (man/tir etter 12); ga kort kunde-/format-utgangspunkt." },
];
async function main() {
  for (const a of ACKS) {
    const t = await prisma.title.findFirst({ where: { slug: a.slug }, select: { id: true, name: true } });
    if (!t) { console.log(`! ${a.slug} not found`); continue; }
    if ((await prisma.contactLog.count({ where: { titleId: t.id, direction: "OUTBOUND", note: { contains: TAG } } })) > 0) { console.log(`${t.name}: already`); continue; }
    await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "OUTBOUND", note: `OUTBOUND 2026-06-10 (→ ${a.to}): ${a.note} ${TAG}`, actorId: ACTOR });
    console.log(`${t.name}: ← OUTBOUND logged`);
  }
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
