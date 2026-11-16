// The database half of buyer self-service: decline a sent quote, withdraw a
// request, ask for an order to be cancelled. Each function re-reads the row,
// checks the caller's seat in THAT row's organisation (never an id from the
// form) and writes with a compare-and-set, so a quote accepted in another tab
// can't also be declined.
//
// The server actions in src/app/buyer-self-service-actions.ts are thin
// wrappers: they map the outcome to a redirect, and send the audit row and
// the desk notice. Keeping the rules here makes them testable against a real
// database without a session (see buyer-self-service-db.it.test.ts).

import { prisma } from "@/lib/prisma";
import { canActOnOrg, canCommitOnOrg, canEditOnOrg, type Scope } from "@/lib/scope";
import { isViewingAs } from "@/lib/view-as";
import {
  canDeclineQuote,
  canRequestCancellation,
  canWithdrawRequest,
} from "@/lib/buyer-self-service";

// What the functions need from a Scope. `loadScope()` satisfies it; tests
// build one from `loadWorkspace`.
export type SelfServiceScope = Pick<Scope, "isDesk" | "workspace" | "userId">;

const asScope = (s: SelfServiceScope): Scope => s as Scope;

/** A superadmin viewing as the customer acts for real only with the same
 *  explicit confirmation the accept form asks for. */
function viewAsBlocked(scope: SelfServiceScope, organizationId: string, viewAsConfirmed: boolean) {
  return isViewingAs(scope.workspace, organizationId) && !viewAsConfirmed;
}

type Subject = { organizationId: string; orgName: string; planName: string };

export type DeclineOutcome =
  | { outcome: "not-found" }
  | { outcome: "forbidden" }
  | ({ outcome: "not-allowed" | "needs-confirm" | "unavailable" } & { requestId: string })
  | ({ outcome: "declined"; requestId: string; quoteId: string; requestClosed: boolean } & Subject);

// Decline a sent quote. Declining is the mirror of accepting, so it needs the
// same commit seat.
export async function declineQuoteForBuyer(
  scope: SelfServiceScope,
  quoteId: string,
  reason: string | null,
  opts: { viewAsConfirmed?: boolean; now?: Date } = {},
): Promise<DeclineOutcome> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      status: true,
      order: { select: { id: true } },
      request: {
        select: {
          id: true,
          organizationId: true,
          organization: { select: { name: true } },
          plan: { select: { name: true } },
        },
      },
    },
  });
  if (!quote) return { outcome: "not-found" };
  const request = quote.request;
  const orgId = request.organizationId;

  if (!canActOnOrg(asScope(scope), orgId)) return { outcome: "forbidden" };
  if (!canCommitOnOrg(asScope(scope), orgId)) return { outcome: "not-allowed", requestId: request.id };
  if (viewAsBlocked(scope, orgId, !!opts.viewAsConfirmed)) {
    return { outcome: "needs-confirm", requestId: request.id };
  }
  if (!canDeclineQuote(quote)) return { outcome: "unavailable", requestId: request.id };

  const now = opts.now ?? new Date();
  // CAS on status + "no order": loses cleanly to a concurrent accept.
  const { count } = await prisma.quote.updateMany({
    where: { id: quote.id, status: "SENT", order: null },
    data: { status: "DECLINED", declinedAt: now, declineReason: reason },
  });
  if (count === 0) return { outcome: "unavailable", requestId: request.id };

  // Close the request once nothing on it is still open for the buyer.
  const stillOpen = await prisma.quote.count({
    where: { requestId: request.id, status: { in: ["DRAFT", "SENT"] } },
  });
  let requestClosed = false;
  if (stillOpen === 0) {
    const closed = await prisma.request.updateMany({
      where: { id: request.id, status: { in: ["IN_REVIEW", "QUOTED"] } },
      data: { status: "CLOSED" },
    });
    requestClosed = closed.count > 0;
  }

  return {
    outcome: "declined",
    requestId: request.id,
    quoteId: quote.id,
    requestClosed,
    organizationId: orgId,
    orgName: request.organization.name,
    planName: request.plan.name,
  };
}

export type WithdrawOutcome =
  | { outcome: "not-found" }
  | { outcome: "forbidden" }
  | { outcome: "not-allowed" | "unavailable"; requestId: string }
  | ({ outcome: "withdrawn"; requestId: string } & Subject);

// Withdraw a request the desk has not turned into an order. Any open quotes
// on it are declined with the same reason.
export async function withdrawRequestForBuyer(
  scope: SelfServiceScope,
  requestId: string,
  reason: string | null,
  opts: { now?: Date } = {},
): Promise<WithdrawOutcome> {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      organizationId: true,
      organization: { select: { name: true } },
      plan: { select: { name: true } },
      quotes: { select: { status: true, order: { select: { id: true } } } },
    },
  });
  if (!request) return { outcome: "not-found" };
  const orgId = request.organizationId;

  if (!canActOnOrg(asScope(scope), orgId)) return { outcome: "forbidden" };
  if (!canEditOnOrg(asScope(scope), orgId)) return { outcome: "not-allowed", requestId: request.id };
  if (!canWithdrawRequest(request)) return { outcome: "unavailable", requestId: request.id };

  const now = opts.now ?? new Date();
  const withdrawn = await prisma.$transaction(async (tx) => {
    // An accept that landed since the read creates an Order — refuse then.
    const orders = await tx.order.count({ where: { quote: { requestId: request.id } } });
    if (orders > 0) return false;
    const { count } = await tx.request.updateMany({
      where: { id: request.id, status: { in: ["SUBMITTED", "IN_REVIEW", "QUOTED"] } },
      data: { status: "CLOSED", withdrawnAt: now, withdrawReason: reason },
    });
    if (count === 0) return false;
    await tx.quote.updateMany({
      where: { requestId: request.id, status: { in: ["DRAFT", "SENT"] }, order: null },
      data: { status: "DECLINED", declinedAt: now, declineReason: reason },
    });
    return true;
  });
  if (!withdrawn) return { outcome: "unavailable", requestId: request.id };

  return {
    outcome: "withdrawn",
    requestId: request.id,
    organizationId: orgId,
    orgName: request.organization.name,
    planName: request.plan.name,
  };
}

export type CancellationOutcome =
  | { outcome: "not-found" }
  | { outcome: "forbidden" }
  | { outcome: "not-allowed" | "needs-confirm" | "reason-required" | "unavailable"; orderId: string }
  | ({ outcome: "requested"; orderId: string; reason: string } & Subject);

// Ask the desk to cancel a confirmed order. This is a REQUEST: bookings with
// publishers may carry cancellation terms, so the desk decides and runs
// cancelOrder itself. The order's status does not change here.
export async function requestOrderCancellationForBuyer(
  scope: SelfServiceScope,
  orderId: string,
  reason: string | null,
  opts: { viewAsConfirmed?: boolean; now?: Date } = {},
): Promise<CancellationOutcome> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      organizationId: true,
      cancellationRequestedAt: true,
      organization: { select: { name: true } },
      quote: { select: { request: { select: { plan: { select: { name: true } } } } } },
    },
  });
  if (!order) return { outcome: "not-found" };
  const orgId = order.organizationId;

  if (!canActOnOrg(asScope(scope), orgId)) return { outcome: "forbidden" };
  if (!scope.userId || !canCommitOnOrg(asScope(scope), orgId)) {
    return { outcome: "not-allowed", orderId: order.id };
  }
  if (viewAsBlocked(scope, orgId, !!opts.viewAsConfirmed)) {
    return { outcome: "needs-confirm", orderId: order.id };
  }
  if (!reason) return { outcome: "reason-required", orderId: order.id };
  if (!canRequestCancellation(order)) return { outcome: "unavailable", orderId: order.id };

  // CAS: one open ask at a time, and only while the order is still in the
  // state the buyer saw.
  const { count } = await prisma.order.updateMany({
    where: { id: order.id, cancellationRequestedAt: null, status: order.status },
    data: {
      cancellationRequestedAt: opts.now ?? new Date(),
      cancellationRequestReason: reason,
      cancellationRequestedBy: scope.userId,
    },
  });
  if (count === 0) return { outcome: "unavailable", orderId: order.id };

  return {
    outcome: "requested",
    orderId: order.id,
    reason,
    organizationId: orgId,
    orgName: order.organization.name,
    planName: order.quote.request.plan.name,
  };
}
