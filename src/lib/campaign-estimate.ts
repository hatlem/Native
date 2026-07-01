// Live shortlist estimate for the guided campaign flow. Pure + DB-free so it
// unit-tests cleanly; the rail component maps SavedList items into these lines.
//
// Mirrors the /plan rollup semantics: visible-price lines accumulate an amount
// per currency; locked-price lines only register their currency (so a
// tri-Nordic shortlist still shows NOK + SEK + DKK rows even when one has no
// visible total yet). Reach is summed over UNIQUE titles — two placements on
// the same title don't double-count its audience.

export type EstimateLine = {
  currency: string;
  lineTotal: number;
  priceVisible: boolean;
  titleId: string;
  reach: number;
};

export type CurrencyTotal = {
  currency: string;
  amount: number;
  hasVisible: boolean;
  hasHidden: boolean;
};

export type CampaignEstimate = {
  totals: CurrencyTotal[];
  reach: number;
  itemCount: number;
};

export function computeEstimate(lines: EstimateLine[]): CampaignEstimate {
  const byCurrency = new Map<string, CurrencyTotal>();
  const reachByTitle = new Map<string, number>();

  for (const l of lines) {
    const t = byCurrency.get(l.currency) ?? {
      currency: l.currency,
      amount: 0,
      hasVisible: false,
      hasHidden: false,
    };
    if (l.priceVisible) {
      t.amount += l.lineTotal;
      t.hasVisible = true;
    } else {
      t.hasHidden = true;
    }
    byCurrency.set(l.currency, t);

    // Keep the largest reach seen for a title (placements can carry differing
    // estimates); never sum within a title.
    const prev = reachByTitle.get(l.titleId) ?? 0;
    if (l.reach > prev) reachByTitle.set(l.titleId, l.reach);
  }

  // Visible-first ordering so "real number" currencies lead.
  const totals = [...byCurrency.values()].sort(
    (a, b) => (a.hasVisible ? 0 : 1) - (b.hasVisible ? 0 : 1),
  );
  const reach = [...reachByTitle.values()].reduce((sum, r) => sum + r, 0);

  return { totals, reach, itemCount: lines.length };
}
