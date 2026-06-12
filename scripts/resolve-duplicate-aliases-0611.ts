/** Manual resolution of the duplicate-alias cases the auto-fixer (URL match) left.
 * Survivors are taken from each dead title's discontinuedNote ("same publication as
 * X", "renamed to X; survivor kept"). Two kinds:
 *   BY_ID  — survivor id is known from the review dump.
 *   BY_NAME — survivor identified by exact active name (looked up here).
 * Skipped on purpose (documented, no alias): "Bonytt Hytteliv" (junk conflation of
 * the real titles Bonytt + Hytteliv), and any name with no active survivor found
 * (printed as UNRESOLVED for a human).
 * Dry-run by default; --apply to write.
 */
import { prisma } from "@/lib/prisma";
const APPLY = process.argv.includes("--apply");

const BY_ID: Record<string, string[]> = {
  cmpmdiqan02r60hu0hyw9haev: ["Forbundet Arkitekters Tidsskrift"],        // Arkitekten
  cmpmdiqbe03rr0hu09qzdhwz7: ["Kurier.at"],                              // Kurier
  cmpmdiqa001s60hu0et9cgv75: ["M Magazine"],                            // M! magasinet
  cmpmdiqaa02700hu0ish4aade: ["KK (Kvinner og Klær)", "Kvinner og Klær"], // KK
  cmpmdiq9x01o10hu076tofoir: ["Argument (Oslo)"],                       // Argument
  cmpmdiqb403d20hu0gvtsj294: ["The Irish Times Weekend"],               // Irish Times
  cmpmdiqb703g10hu0238v5jah: ["Construction Magazine"],                 // Irish Construction News
};
// survivor exact name (active) -> aliases to add
const BY_NAME: { name: string; market: string; add: string[] }[] = [
  { name: "Restaurant", market: "UK", add: ["Big Hospitality", "BigHospitality"] },
  { name: "Lindesnes", market: "NO", add: ["Lindesnes Avis Nord"] },
  { name: "Dagbladet Holstebro-Struer", market: "DK", add: ["Dagbladet Struer", "Dagbladet Holstebro", "Struer Dagblad", "Holstebro Dagblad"] },
  { name: "Akademikerbladet", market: "DK", add: ["Akademikerbladet (AC)"] },
];

async function addAliases(id: string, add: string[], label: string) {
  const t = await prisma.title.findUnique({ where: { id }, select: { name: true, aliases: true, active: true } });
  if (!t) { console.log(`  UNRESOLVED: survivor id ${id} not found (${label})`); return; }
  const want = add.filter((a) => a !== t.name && !t.aliases.includes(a));
  if (!want.length) { console.log(`  ok (already) ${t.name}`); return; }
  console.log(`  ✓ ${t.name} <- ${JSON.stringify(want)}`);
  if (APPLY) await prisma.title.update({ where: { id }, data: { aliases: { set: [...t.aliases, ...want] } } });
}

async function main() {
  console.log("BY_ID:");
  for (const [id, add] of Object.entries(BY_ID)) await addAliases(id, add, add.join("/"));

  console.log("BY_NAME:");
  for (const r of BY_NAME) {
    const m = await prisma.market.findFirst({ where: { code: r.market as import("@prisma/client").MarketCode }, select: { id: true } });
    const survivors = await prisma.title.findMany({
      where: { name: r.name, active: true, discontinuedAt: null, ...(m ? { marketId: m.id } : {}) },
      select: { id: true, name: true, aliases: true },
    });
    if (survivors.length !== 1) { console.log(`  UNRESOLVED: "${r.name}" (${r.market}) matched ${survivors.length} active titles — manual`); continue; }
    await addAliases(survivors[0].id, r.add, r.name);
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"}`);
}
main().finally(() => prisma.$disconnect());
