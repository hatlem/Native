/** Review dump for the duplicate-alias cases the auto-fixer could not resolve:
 *  - AMBIGUOUS: several active titles share the dead title's websiteUrl
 *  - NO SURVIVOR (by URL): no active title shares the URL — survivor may live on a
 *    different URL; the discontinuedNote usually names it.
 * Prints the dead title + its note + candidate survivors (same market) ranked by
 * URL-host and name-token overlap, so a human can pick the right survivor. Read-only.
 * Run: railway run --service Postgres sh -c \
 *   'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm tsx scripts/review-duplicate-aliases-0611.ts'
 */
import { prisma } from "@/lib/prisma";

const host = (s: string | null) =>
  (s || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
const norm = (s: string | null) => (s || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^\p{Letter}\p{Number}\s]/gu, " ").split(/\s+/).filter((t) => t.length >= 3));

async function main() {
  const dups = await prisma.title.findMany({
    where: { discontinuedAt: { not: null }, discontinuedNote: { contains: "DUPLICATE" } },
    select: { id: true, name: true, aliases: true, websiteUrl: true, marketId: true, countryCode: true, discontinuedNote: true },
  });

  for (const d of dups) {
    const survivors = await prisma.title.findMany({
      where: { active: true, discontinuedAt: null, marketId: d.marketId, id: { not: d.id } },
      select: { id: true, name: true, aliases: true, websiteUrl: true },
    });
    const exactUrl = survivors.filter((s) => norm(s.websiteUrl) === norm(d.websiteUrl) && d.websiteUrl);
    const alreadyHas = exactUrl.length === 1 && (exactUrl[0].aliases.includes(d.name) || exactUrl[0].name === d.name);
    if (exactUrl.length === 1 && (alreadyHas || true)) continue; // resolved by auto-fixer (exactly one URL match)

    // unresolved: ambiguous (>1 url match) or none. Build candidates.
    const dTok = tokens(d.name + " " + d.aliases.join(" "));
    const cand = survivors
      .map((s) => {
        const sameHost = host(s.websiteUrl) === host(d.websiteUrl) && !!host(d.websiteUrl);
        const overlap = [...tokens(s.name + " " + s.aliases.join(" "))].filter((t) => dTok.has(t)).length;
        return { s, sameHost, overlap };
      })
      .filter((c) => c.sameHost || c.overlap > 0)
      .sort((a, b) => Number(b.sameHost) - Number(a.sameHost) || b.overlap - a.overlap)
      .slice(0, 5);

    const kind = exactUrl.length > 1 ? `AMBIGUOUS (${exactUrl.length} on ${host(d.websiteUrl)})` : "NO URL MATCH";
    console.log(`\n=== ${kind} ===`);
    console.log(`DEAD: "${d.name}" (${d.countryCode}) url=${norm(d.websiteUrl) || "—"} id=${d.id}`);
    console.log(`NOTE: ${(d.discontinuedNote || "").slice(0, 280)}`);
    if (!cand.length) { console.log(`  candidates: none in-market`); continue; }
    cand.forEach((c) =>
      console.log(`  → survivor "${c.s.name}" url=${norm(c.s.websiteUrl) || "—"} ${c.sameHost ? "[same-host]" : ""} overlap=${c.overlap} aliases=${JSON.stringify(c.s.aliases)} id=${c.s.id}`),
    );
  }
}
main().finally(() => prisma.$disconnect());
