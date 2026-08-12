import { prisma } from "@/lib/prisma";
import type { MarketCode } from "@prisma/client";

export type RelevanceSignals = {
  marketCode: MarketCode | null;
  affinityVerticals: string[];
};

const OWN_SIGNAL_TAKE = 200;
const MARKET_SIGNAL_TAKE = 300;
const MAX_AFFINITY_VERTICALS = 5;

// The org's own top verticals, from what it has favorited or added to a
// plan — a direct, first-party expression of interest.
async function ownTopVerticals(organizationId: string): Promise<string[]> {
  const [favoriteRows, savedRows] = await Promise.all([
    prisma.favorite.findMany({
      where: { user: { organizationId } },
      select: { title: { select: { vertical: true } } },
      take: OWN_SIGNAL_TAKE,
    }),
    prisma.savedListItem.findMany({
      where: { list: { organizationId }, titleId: { not: null } },
      select: { title: { select: { vertical: true } } },
      take: OWN_SIGNAL_TAKE,
    }),
  ]);
  return topByCount([...favoriteRows, ...savedRows], 3);
}

// What other orgs in the SAME market are favoriting / planning right now —
// a discovery signal independent of this org's own history, so relevance
// isn't just an echo of what it already picked. Scoped to the org's market
// (not global) so it reads as "active in your market," not noise from
// unrelated verticals.
async function marketPopularVerticals(
  marketCode: MarketCode,
  excludeOrgId: string,
): Promise<string[]> {
  const [favoriteRows, savedRows] = await Promise.all([
    prisma.favorite.findMany({
      where: {
        title: { countryCode: marketCode },
        user: { organizationId: { not: excludeOrgId } },
      },
      select: { title: { select: { vertical: true } } },
      orderBy: { createdAt: "desc" },
      take: MARKET_SIGNAL_TAKE,
    }),
    prisma.savedListItem.findMany({
      where: {
        titleId: { not: null },
        title: { is: { countryCode: marketCode } },
        list: { organizationId: { not: excludeOrgId } },
      },
      select: { title: { select: { vertical: true } } },
      orderBy: { createdAt: "desc" },
      take: MARKET_SIGNAL_TAKE,
    }),
  ]);
  return topByCount([...favoriteRows, ...savedRows], 3);
}

function topByCount(rows: { title: { vertical: string | null } | null }[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = row.title?.vertical;
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([v]) => v);
}

// Personalizes the catalog's default ("relevance") ordering. Deliberately
// broader than "show me what I already saved": the org's own picks are one
// input, not the whole signal — blended with what similar buyers in the
// same market are actively favoriting/planning, so browsing surfaces things
// worth discovering, not just a mirror of past activity. Org-scoped (not
// user-scoped) so the whole team benefits from what any seat has done.
export async function loadRelevanceSignals(organizationId: string): Promise<RelevanceSignals> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { marketCode: true },
  });
  const marketCode = org?.marketCode ?? null;

  const [own, market] = await Promise.all([
    ownTopVerticals(organizationId),
    marketCode ? marketPopularVerticals(marketCode, organizationId) : Promise.resolve([]),
  ]);

  // Own signal first — it's the stronger, first-party expression of
  // interest — then broaden with what's active in-market, deduped.
  const affinityVerticals = [...new Set([...own, ...market])].slice(0, MAX_AFFINITY_VERTICALS);

  return { marketCode, affinityVerticals };
}
