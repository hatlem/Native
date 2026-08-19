export type CampaignStage = 1 | 2 | 3 | 4 | 5 | 6;

// Plan built -> Sent -> Quoted -> Approved -> Live -> Finished, derived from
// Request + latest Quote + (if the quote became one) Order — never from
// Request.status alone. firm-order.ts (instant-book / firm-price checkout)
// creates the Request directly at status "CLOSED" with an ACCEPTED quote and
// a CONFIRMED order in the same transaction — so a CLOSED request can mean
// "dead RFQ" (no order) or "already at Approved+" (has an order), and only
// checking Order existence first tells them apart. Stage 6 is terminal-good:
// the flight ran (COMPLETED/INVOICED) — distinct from LIVE because "finished"
// is an actionable state now (plan the next wave), not a synonym for running.
export function deriveStage(input: {
  requestStatus: string;
  quoteStatus: string | null;
  orderStatus: string | null;
}): CampaignStage {
  if (input.orderStatus) {
    if (["COMPLETED", "INVOICED"].includes(input.orderStatus)) return 6;
    return input.orderStatus === "LIVE" ? 5 : 4;
  }
  // A quote exists but hasn't become an order yet — still "Quoted" even if
  // it has since expired or been declined; the row should keep surfacing
  // at this stage rather than silently reverting to "Sent".
  if (input.quoteStatus) return 3;
  if (input.requestStatus === "DRAFT") return 1;
  return 2;
}
