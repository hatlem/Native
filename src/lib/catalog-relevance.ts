import { prisma } from "@/lib/prisma";
import type { MarketCode } from "@prisma/client";

export type RelevanceSignals = {
  marketCode: MarketCode | null;
  affinityVerticals: string[];
};

// Personalizes the catalog's default ("relevance") ordering using what we
// already know about the org rather than a new query-history feature: its
// billing market (country), and the verticals of titles it has already
// favorited or added to a plan (profile/behavior). Org-scoped, not
// user-scoped, so the whole team benefits from what any seat has shown
// interest in.
export async function loadRelevanceSignals(organizationId: string): Promise<RelevanceSignals> {
  const [org, favoriteVerticals, savedVerticals] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { marketCode: true },
    }),
    prisma.favorite.findMany({
      where: { user: { organizationId } },
      select: { title: { select: { vertical: true } } },
      take: 200,
    }),
    prisma.savedListItem.findMany({
      where: { list: { organizationId }, titleId: { not: null } },
      select: { title: { select: { vertical: true } } },
      take: 200,
    }),
  ]);

  const counts = new Map<string, number>();
  for (const row of [...favoriteVerticals, ...savedVerticals]) {
    const v = row.title?.vertical;
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const affinityVerticals = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([v]) => v);

  return { marketCode: org?.marketCode ?? null, affinityVerticals };
}
