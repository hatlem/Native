// Second-pass cleanup for digitalReach. StatShow can only measure
// traffic at the domain level — so when a Title's websiteUrl is
//   (a) a path on a parent platform (e.g. /journal/x on sciencedirect.com),
//   (b) a Facebook page (facebook.com/foo), or
//   (c) shared with one or more other catalog titles (FT, Daily Mail,
//        BBC sub-publications all return the parent's traffic),
// the number we wrote is the platform's traffic, not the title's.
// Those are misattributions — null them out so the catalog falls back
// to the honest combined-readers label.

import { prisma } from "@/lib/prisma";

function pathPart(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function domain(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.host.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// Domains where the parent platform's traffic dwarfs any individual
// title's. Anything pointing to one of these is unreliable regardless
// of path.
const PLATFORM_DOMAINS = new Set([
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "instagram.com",
  "youtube.com",
  "sciencedirect.com",
  "tandfonline.com",
  "springer.com",
  "wiley.com",
  "elsevier.com",
  "jstor.org",
  "cambridge.org",
  "oup.com",
  "researchgate.net",
  "academia.edu",
]);

async function main() {
  const titles = await prisma.title.findMany({
    where: { digitalReach: { not: null } },
    select: { id: true, name: true, websiteUrl: true, digitalReach: true },
  });

  // 1) titles whose URL has a path = section of a larger site
  // 2) titles on known platforms
  // 3) titles sharing a domain with other catalog rows
  const byDomain = new Map<string, string[]>();
  for (const t of titles) {
    if (!t.websiteUrl) continue;
    const d = domain(t.websiteUrl);
    if (!d) continue;
    (byDomain.get(d) ?? byDomain.set(d, []).get(d)!).push(t.id);
  }

  const toNull = new Set<string>();
  const reasons: Record<string, number> = {
    path: 0,
    platform: 0,
    shared: 0,
  };

  for (const t of titles) {
    if (!t.websiteUrl) continue;
    const d = domain(t.websiteUrl);
    if (!d) continue;
    const p = pathPart(t.websiteUrl);
    let drop = false;
    if (p && p !== "" && p !== "/") {
      reasons.path++;
      drop = true;
    }
    if (PLATFORM_DOMAINS.has(d)) {
      reasons.platform++;
      drop = true;
    }
    if ((byDomain.get(d) ?? []).length > 1) {
      reasons.shared++;
      drop = true;
    }
    if (drop) toNull.add(t.id);
  }

  console.log("Reasons (overlapping):", reasons);
  console.log(`Unique titles to null: ${toNull.size}`);

  const res = await prisma.title.updateMany({
    where: { id: { in: [...toNull] } },
    data: { digitalReach: null },
  });
  console.log(`Nulled: ${res.count}`);

  // Recap top 10 after cleanup
  const top = await prisma.title.findMany({
    where: { digitalReach: { not: null } },
    orderBy: { digitalReach: "desc" },
    take: 10,
    select: { name: true, websiteUrl: true, digitalReach: true, market: { select: { code: true } } },
  });
  console.log("\nTop 10 after cleanup:");
  for (const t of top) {
    console.log(`  ${t.digitalReach!.toLocaleString().padStart(13)}  ${t.market.code}  ${t.name}  ←  ${t.websiteUrl}`);
  }

  const total = await prisma.title.count();
  const withDigital = await prisma.title.count({ where: { digitalReach: { not: null } } });
  console.log(`\nCoverage: ${withDigital} / ${total} (${Math.round((withDigital / total) * 100)}%)`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
