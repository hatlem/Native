// Opportunistic, on-read reconciliation of quote expiry (no cron/worker) —
// the same pattern workspace.ts uses for memberships. Views and the accept
// gate already derive expiry from validUntil (quote-validity.ts), so this is
// bookkeeping only: it keeps the stored status honest for desk reports and
// the API. Callers fire-and-forget.

import { prisma } from "@/lib/prisma";
import { expiredSentQuoteWhere } from "@/lib/commerce/quote-validity";

export async function reconcileExpiredQuotes(
  scope: { organizationIds: string[] } | { requestId: string },
  now: Date = new Date(),
): Promise<number> {
  const where =
    "requestId" in scope
      ? { requestId: scope.requestId }
      : { request: { organizationId: { in: scope.organizationIds } } };
  if ("organizationIds" in scope && scope.organizationIds.length === 0) return 0;
  const { count } = await prisma.quote.updateMany({
    where: { ...where, ...expiredSentQuoteWhere(now), order: null },
    data: { status: "EXPIRED" },
  });
  return count;
}

/** Fire-and-forget wrapper: never lets bookkeeping break a page render. */
export function reconcileExpiredQuotesInBackground(
  scope: Parameters<typeof reconcileExpiredQuotes>[0],
): void {
  void reconcileExpiredQuotes(scope).catch((err) =>
    console.error("quote.reconcile_expired_failed", { scope, err }),
  );
}
