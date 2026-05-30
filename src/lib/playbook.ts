// Content-playbook matching. The pure `pickPlaybook` picks the most
// specific active playbook for a placement; `loadPlaybookFor` is the thin
// DB wrapper used by the desk order/brief views. Kept split so the matcher
// is unit-testable without a DB.

import { prisma } from "@/lib/prisma";

export type PlaybookMatchable = {
  productType: string | null;
  category: string | null;
  marketCode: string | null;
  active: boolean;
};

// Most-specific active match wins. productType is weighted highest (it
// drives the writing far more than geography), then category, then market.
// A playbook whose non-null dimension contradicts the placement is
// ineligible. Returns null when nothing matches.
export function pickPlaybook<T extends PlaybookMatchable>(
  playbooks: T[],
  productType: string,
  category: string,
  marketCode: string,
): T | null {
  const eligible = playbooks.filter(
    (p) =>
      p.active &&
      (p.productType === null || p.productType === productType) &&
      (p.category === null || p.category === category) &&
      (p.marketCode === null || p.marketCode === marketCode),
  );
  if (eligible.length === 0) return null;
  const score = (p: PlaybookMatchable) =>
    (p.productType === productType ? 4 : 0) +
    (p.category === category ? 2 : 0) +
    (p.marketCode === marketCode ? 1 : 0);
  return [...eligible].sort((a, b) => score(b) - score(a))[0];
}

// Load the matching playbook for a placement straight from the DB.
export async function loadPlaybookFor(
  productType: string,
  category: string,
  marketCode: string,
) {
  const playbooks = await prisma.playbook.findMany({ where: { active: true } });
  return pickPlaybook(
    playbooks.map((p) => ({
      ...p,
      productType: p.productType as string | null,
      marketCode: p.marketCode as string | null,
    })),
    productType,
    category,
    marketCode,
  );
}
