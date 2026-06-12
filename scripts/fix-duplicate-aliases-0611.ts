/** Duplicates were deactivated with a [DUPLICATE] discontinuedNote, but the dead
 * title's NAME was not always folded into the surviving title's `aliases`. Since
 * catalog search FTS indexes name + aliases (searchTsv, weight A), a missing alias
 * means searching the old name (e.g. "Byggeindustrien") no longer surfaces the
 * survivor (e.g. "Bygg.no") — the link is lost to everything but the dead note.
 *
 * This finds every discontinued DUPLICATE title and, where a single active
 * survivor shares its websiteUrl (and market), ensures the dead name (+ the dead
 * title's own aliases) are present on the survivor's aliases.
 *
 * Dry-run by default; pass --apply to write.
 * Run: railway run --service Postgres sh -c \
 *   'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm tsx scripts/fix-duplicate-aliases-0611.ts [--apply]'
 */
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");

const norm = (s: string | null) =>
  (s || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();

async function main() {
  const dups = await prisma.title.findMany({
    where: { discontinuedAt: { not: null }, discontinuedNote: { contains: "DUPLICATE" } },
    select: { id: true, name: true, aliases: true, websiteUrl: true, marketId: true, countryCode: true },
  });
  console.log(`discontinued DUPLICATE titles: ${dups.length}`);

  let fixed = 0, noSurvivor = 0, ambiguous = 0, alreadyOk = 0;
  for (const d of dups) {
    if (!d.websiteUrl) { noSurvivor++; console.log(`  ? ${d.name}: no websiteUrl to match survivor`); continue; }
    const survivors = await prisma.title.findMany({
      where: { active: true, discontinuedAt: null, marketId: d.marketId, id: { not: d.id } },
      select: { id: true, name: true, aliases: true, websiteUrl: true },
    });
    const match = survivors.filter((s) => norm(s.websiteUrl) === norm(d.websiteUrl));
    if (match.length === 0) { noSurvivor++; console.log(`  ? ${d.name} (${d.countryCode}): no active survivor on ${norm(d.websiteUrl)}`); continue; }
    if (match.length > 1) { ambiguous++; console.log(`  ! ${d.name} (${d.countryCode}): ${match.length} survivors on ${norm(d.websiteUrl)} — skip`); continue; }
    const s = match[0];
    const want = [d.name, ...d.aliases].filter((a) => a && a !== s.name && !s.aliases.includes(a));
    if (want.length === 0) { alreadyOk++; continue; }
    console.log(`  ✓ ${s.name} <- alias ${JSON.stringify(want)} (from dead "${d.name}")`);
    if (APPLY)
      await prisma.title.update({ where: { id: s.id }, data: { aliases: { set: [...s.aliases, ...want] } } });
    fixed++;
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — would-fix: ${fixed} | already ok: ${alreadyOk} | no survivor: ${noSurvivor} | ambiguous: ${ambiguous}`);
}
main().finally(() => prisma.$disconnect());
