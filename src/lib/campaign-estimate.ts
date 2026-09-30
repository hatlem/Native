// Live shortlist reach for the guided campaign flow. Pure + DB-free so it
// unit-tests cleanly; the rail component maps SavedList items into these
// lines. The rail's MONEY comes from lib/plan-total.ts (estimateListTotals),
// the engine every plan surface shares, so the campaign rail can never show a
// figure /plan doesn't — exact for instant-orderable lines, a band otherwise.
//
// Reach is summed over UNIQUE titles — two placements on the same title don't
// double-count its audience.

export type ReachLine = {
  titleId: string;
  reach: number;
};

export type CampaignReach = {
  reach: number;
  itemCount: number;
};

export function computeReach(lines: ReachLine[]): CampaignReach {
  const reachByTitle = new Map<string, number>();
  for (const l of lines) {
    // Keep the largest reach seen for a title (placements can carry differing
    // estimates); never sum within a title.
    const prev = reachByTitle.get(l.titleId) ?? 0;
    if (l.reach > prev) reachByTitle.set(l.titleId, l.reach);
  }
  const reach = [...reachByTitle.values()].reduce((sum, r) => sum + r, 0);
  return { reach, itemCount: lines.length };
}
