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
  kind: "INVENTORY" | "CONTENT_FEE" | "EXTRA_WORK";
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
    // Billed extra hours are the same production service as the article
    // fee, not a markup on inventory.
    if (l.kind === "CONTENT_FEE" || l.kind === "EXTRA_WORK") {
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

// ---------- Desk revenue report ----------
// What the desk "GMV" and "margin vs content fee" cards add up, per
// currency. Pure so the rules are pinned by tests:
//   - a CANCELLED order earned nothing (a fully credited one ends
//     CANCELLED too) and is left out;
//   - credit notes on an order that is still live are subtracted;
//   - extra work agreed after acceptance (OrderExtraWork) is revenue the
//     accepted quote does not contain, so it is added — as production
//     service, with the order's VAT in GMV;
//   - "price on request" lines were never agreed or billed, so they are
//     neither revenue nor (negative) margin.

export type ReportOrder = {
  status: string;
  currency: string;
  // The accepted quote's VAT-inclusive total and VAT rate.
  quoteTotal: number;
  vatPct: number;
  lines: (RevenueLine & { priceOnRequest?: boolean })[];
  // Net amounts of extra work added after acceptance.
  extraWork: number[];
  // VAT-inclusive amounts of credit notes issued against the order.
  credited: number[];
};

export type CurrencyRevenue = {
  currency: string;
  count: number;
  gmv: number;
  aov: number;
  split: RevenueSplit;
};

export function deskRevenueByCurrency(orders: ReportOrder[]): CurrencyRevenue[] {
  const byCurrency = new Map<string, ReportOrder[]>();
  for (const o of orders) {
    if (o.status === "CANCELLED") continue;
    byCurrency.set(o.currency, [...(byCurrency.get(o.currency) ?? []), o]);
  }
  return [...byCurrency.entries()]
    .map(([currency, inCur]) => {
      let gmv = 0;
      const lines: RevenueLine[] = [];
      for (const o of inCur) {
        const extraNet = o.extraWork.reduce((s, a) => s + a, 0);
        const credited = o.credited.reduce((s, a) => s + a, 0);
        gmv += o.quoteTotal + extraNet * (1 + o.vatPct / 100) - credited;
        for (const l of o.lines) {
          if (l.priceOnRequest) continue;
          lines.push({ kind: l.kind, unitCost: l.unitCost, quantity: l.quantity, lineTotal: l.lineTotal });
        }
        for (const amount of o.extraWork) {
          lines.push({ kind: "EXTRA_WORK", unitCost: 0, quantity: 1, lineTotal: amount });
        }
      }
      gmv = Math.round(gmv);
      return {
        currency,
        count: inCur.length,
        gmv,
        aov: averageOrderValue(gmv, inCur.length),
        split: revenueSplit(lines),
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

// Click-through rate as a percentage with one decimal. Returns null (not 0)
// when impressions are missing/zero so the caller can show "—" instead of a
// misleading 0%. Compute per publisher over bookings with reported impressions.
export function ctrPct(clicks: number, impressions: number | null): number | null {
  if (impressions === null || impressions <= 0) return null;
  return Math.round((clicks / impressions) * 1000) / 10;
}
