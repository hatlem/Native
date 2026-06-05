// Phase 4 reporting — pure aggregation helpers (PLAN.md §18 KPIs).
// Kept DB-agnostic and side-effect-free so they can be unit tested and
// reused by both the desk (platform-wide) and buyer (org-scoped) reports.
// Monetary aggregates are always grouped by currency by the caller so we
// never sum across NOK/SEK/DKK.

export type Tally = { key: string; count: number };

// Count occurrences of each label, highest first (stable for ties by key).
export function tally(labels: string[]): Tally[] {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export type MoneyGroup = { group: string; amount: number };

// Sum amounts per group, largest first. Caller guarantees a single
// currency per call (e.g. one market).
export function sumByGroup(
  rows: { group: string; amount: number }[],
): MoneyGroup[] {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.group, (sums.get(r.group) ?? 0) + r.amount);
  return [...sums.entries()]
    .map(([group, amount]) => ({ group, amount }))
    .sort((a, b) => b.amount - a.amount || a.group.localeCompare(b.group));
}

// Average order value (rounded). 0 when there are no orders.
export function averageOrderValue(total: number, count: number): number {
  return count > 0 ? Math.round(total / count) : 0;
}

// RFQ -> Order conversion as a percentage with one decimal place.
export function conversionPct(requests: number, orders: number): number {
  if (requests <= 0) return 0;
  return Math.round((orders / requests) * 1000) / 10;
}

// ---------- Revenue split: buying margin vs content-fee ----------
// The "margin vs content fee" emphasis, measured from realized quote
// lines. Margin revenue is the markup we keep on inventory (lineTotal
// minus the publisher's cost); content-fee revenue is our production
// service. Caller passes lines from a single currency.

export type RevenueLine = {
  kind: "INVENTORY" | "CONTENT_FEE";
  unitCost: number;
  quantity: number;
  lineTotal: number;
};

export type RevenueSplit = {
  marginRevenue: number; // markup kept on inventory
  contentFeeRevenue: number; // production-service revenue
  totalRevenue: number;
  // Content fee as a share of total revenue, 0..100 with one decimal.
  // 0 when there is no revenue.
  contentFeeRatioPct: number;
};

export function revenueSplit(lines: RevenueLine[]): RevenueSplit {
  let marginRevenue = 0;
  let contentFeeRevenue = 0;
  for (const l of lines) {
    if (l.kind === "CONTENT_FEE") {
      contentFeeRevenue += l.lineTotal;
    } else {
      marginRevenue += l.lineTotal - l.unitCost * l.quantity;
    }
  }
  const totalRevenue = marginRevenue + contentFeeRevenue;
  const contentFeeRatioPct =
    totalRevenue > 0
      ? Math.round((contentFeeRevenue / totalRevenue) * 1000) / 10
      : 0;
  return {
    marginRevenue: Math.round(marginRevenue),
    contentFeeRevenue: Math.round(contentFeeRevenue),
    totalRevenue: Math.round(totalRevenue),
    contentFeeRatioPct,
  };
}

// Click-through rate as a percentage with one decimal. Returns null (not 0)
// when impressions are missing/zero so the caller can show "—" instead of a
// misleading 0%. Compute per publisher over bookings with reported impressions.
export function ctrPct(clicks: number, impressions: number | null): number | null {
  if (impressions === null || impressions <= 0) return null;
  return Math.round((clicks / impressions) * 1000) / 10;
}
