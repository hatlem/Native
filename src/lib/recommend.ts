// Phase 4 recommendations (PLAN.md §181): suggest a title mix for a
// budget. Pure and deterministic so it can be unit tested and reused.
//
// Greedy by reach-per-cost: take the most efficient products first,
// at most one product per title (don't recommend the same title twice),
// while the running cost stays within budget.

export type Candidate = {
  productId: string;
  titleId: string;
  titleName: string;
  category: string;
  type: string;
  reach: number;
  unitPrice: number;
};

export type Recommendation = {
  picks: Candidate[];
  totalCost: number;
  totalReach: number;
  remaining: number;
};

export function recommendMix(
  candidates: Candidate[],
  budget: number,
  opts?: { category?: string },
): Recommendation {
  const pool = opts?.category
    ? candidates.filter((c) => c.category === opts.category)
    : candidates;

  const ranked = [...pool].sort((a, b) => {
    const ea = a.unitPrice > 0 ? a.reach / a.unitPrice : 0;
    const eb = b.unitPrice > 0 ? b.reach / b.unitPrice : 0;
    return (
      eb - ea ||
      b.reach - a.reach ||
      a.titleName.localeCompare(b.titleName)
    );
  });

  const picks: Candidate[] = [];
  const usedTitles = new Set<string>();
  let totalCost = 0;
  let totalReach = 0;

  for (const c of ranked) {
    if (c.unitPrice <= 0) continue;
    if (usedTitles.has(c.titleId)) continue;
    if (totalCost + c.unitPrice > budget) continue;
    picks.push(c);
    usedTitles.add(c.titleId);
    totalCost += c.unitPrice;
    totalReach += c.reach;
  }

  return {
    picks,
    totalCost,
    totalReach,
    remaining: budget - totalCost,
  };
}
