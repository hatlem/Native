// Prints one currency's plan total (lib/plan-total.ts TotalFigure) the same
// way on every surface — /plan, the catalog plan bar (a client component),
// the share page, the requests list, the programme strip, the campaign rail:
//
//   "45 000 kr"                    every priced line is instant-orderable
//   "≈ 40–60k NOK"                 no line is — the summed price bands
//   "45 000 kr + ≈ 40–60k NOK"     both: the exact part, plus the band range
//   "45 000 kr + ≈ 90k+ NOK"       …with an open top band ("from 90k")
//
// Pure and DB-free so the client bar can import it. Excluding VAT, like every
// indicative figure; callers add their own "excl. VAT" / "incl. VAT" copy.

import { formatMoney } from "@/lib/money";
import { rangeLabel } from "./bands";

type Figure = {
  currency: string;
  amount: number;
  hasExact: boolean;
  estimate: { low: number; high: number | null } | null;
};

export function estimateLabel(figure: Pick<Figure, "currency" | "estimate">): string | null {
  return figure.estimate ? `≈ ${rangeLabel(figure.estimate, figure.currency)}` : null;
}

export function totalLabel(figure: Figure, locale: string): string | null {
  const exact = figure.hasExact ? formatMoney(figure.amount, figure.currency, locale) : null;
  const estimate = estimateLabel(figure);
  if (exact && estimate) return `${exact} + ${estimate}`;
  return exact ?? estimate;
}

// The lower bound of what the plan will cost: the exact part plus the bottom
// of the band range. The budget nudge compares against this, so it only fires
// when the budget can't cover even the cheapest outcome.
export function totalFloor(figure: Figure): number {
  return (figure.hasExact ? figure.amount : 0) + (figure.estimate?.low ?? 0);
}
