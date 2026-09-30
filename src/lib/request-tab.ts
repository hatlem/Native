// Which /requests tab a campaign row sits in. Pure, for unit tests.

export type RowTab = "needsYou" | "inProgress" | "live" | "done";

// "inProgress" is everything that isn't awaiting the buyer and isn't
// live/done yet: plan built, sent to the desk, or approved and in production.
// A sent quote "needs you" only when you can accept it: the same rule as
// home (ws.commitOrgIds). For a seat without ordering rights it is still
// under way, waiting on someone on the team who has them.
export function tabForRow(
  orderStatus: string | null,
  quoteStatus: string | null,
  requestStatus: string,
  canCommit: boolean,
): RowTab {
  if (orderStatus === "CANCELLED") return "done";
  if (orderStatus === "LIVE") return "live";
  if (orderStatus === "COMPLETED" || orderStatus === "INVOICED") return "done";
  if (orderStatus) return "inProgress";
  if (quoteStatus === "SENT") return canCommit ? "needsYou" : "inProgress";
  if (quoteStatus === "EXPIRED" || quoteStatus === "DECLINED") return "done";
  if (requestStatus === "CLOSED") return "done";
  return "inProgress";
}

