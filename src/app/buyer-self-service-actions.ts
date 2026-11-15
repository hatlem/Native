"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadScope, canActOnOrg, canCommitOnOrg, canEditOnOrg } from "@/lib/scope";
import { recordAudit } from "@/lib/audit";
import { notifyDesk } from "@/lib/notify";
import { viewAsCommitConfirmed } from "@/lib/view-as";
import {
  canDeclineQuote,
  canGiveFeedback,
  canRequestCancellation,
  isCsatScore,
  canWithdrawRequest,
  normalizeReason,
} from "@/lib/buyer-self-service";

// Buyer self-service: backing out must be as easy as buying. Each action
// re-reads the row, checks the caller's seat in THAT row's organisation
// (never an id from the form), and uses a compare-and-set write so a quote
// accepted in another tab can't also be declined.

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Decline a sent quote, with an optional reason (feeds win/loss reporting).
// Declining is the mirror of accepting, so it needs the same commit seat.
export async function declineQuote(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const quoteId = str(formData, "quoteId");
  const reason = normalizeReason(formData.get("reason"));

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
  if (!quote) redirect(`/${locale}/requests`);
  const request = quote.request;

  const scope = await loadScope();
  if (!canActOnOrg(scope, request.organizationId)) redirect(`/${locale}/signin`);
  const back = `/${locale}/requests/${request.id}`;
  if (!canCommitOnOrg(scope, request.organizationId)) redirect(`${back}?notice=decline-not-allowed`);
  // A superadmin viewing as the customer declines for real: only with the
  // same confirmation the accept form asks for.
  if (!viewAsCommitConfirmed(scope.workspace, request.organizationId, formData)) redirect(back);
  if (!canDeclineQuote(quote)) redirect(`${back}?notice=decline-unavailable`);

  const now = new Date();
  // CAS on status + "no order": loses cleanly to a concurrent accept.
  const { count } = await prisma.quote.updateMany({
    where: { id: quote.id, status: "SENT", order: null },
    data: { status: "DECLINED", declinedAt: now, declineReason: reason },
  });
  if (count === 0) redirect(`${back}?notice=decline-unavailable`);

  // Close the request once nothing on it is still open for the buyer.
  const stillOpen = await prisma.quote.count({
    where: { requestId: request.id, status: { in: ["DRAFT", "SENT"] } },
  });
  if (stillOpen === 0) {
    await prisma.request.updateMany({
      where: { id: request.id, status: { in: ["IN_REVIEW", "QUOTED"] } },
      data: { status: "CLOSED" },
    });
  }

  await recordAudit(scope.userId, "quote.declined_by_buyer", `Quote:${quote.id}`, {
    requestId: request.id,
    organizationId: request.organizationId,
    reason,
  });
  await notifyDesk({
    kind: "QUOTE_DECLINED",
    template: {
      key: "deskQuoteDeclined",
      params: {
        orgName: request.organization.name,
        planName: request.plan.name,
        requestId: request.id,
        reason,
      },
    },
  });

  revalidatePath(back);
  redirect(`${back}?notice=quote-declined`);
}

// Withdraw a request the desk has not turned into an order. Any open quotes
// on it are declined with the same reason.
export async function withdrawRequest(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");
  const reason = normalizeReason(formData.get("reason"));

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
  if (!request) redirect(`/${locale}/requests`);

  const scope = await loadScope();
  if (!canActOnOrg(scope, request.organizationId)) redirect(`/${locale}/signin`);
  const back = `/${locale}/requests/${request.id}`;
  if (!canEditOnOrg(scope, request.organizationId)) redirect(`${back}?notice=withdraw-not-allowed`);
  if (!canWithdrawRequest(request)) redirect(`${back}?notice=withdraw-unavailable`);

  const now = new Date();
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
  if (!withdrawn) redirect(`${back}?notice=withdraw-unavailable`);

  await recordAudit(scope.userId, "request.withdrawn_by_buyer", `Request:${request.id}`, {
    organizationId: request.organizationId,
    reason,
  });
  await notifyDesk({
    kind: "REQUEST_WITHDRAWN",
    template: {
      key: "deskRequestWithdrawn",
      params: {
        orgName: request.organization.name,
        planName: request.plan.name,
        requestId: request.id,
        reason,
      },
    },
  });

  revalidatePath(back);
  redirect(`${back}?notice=request-withdrawn`);
}

// Ask the desk to cancel a confirmed order. This is a REQUEST: bookings with
// publishers may carry cancellation terms, so the desk decides and runs
// cancelOrder itself. The order page shows the ask as pending meanwhile.
export async function requestOrderCancellation(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const orderId = str(formData, "orderId");
  const reason = normalizeReason(formData.get("reason"));

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
  if (!order) redirect(`/${locale}/requests`);

  const scope = await loadScope();
  if (!canActOnOrg(scope, order.organizationId)) redirect(`/${locale}/signin`);
  const back = `/${locale}/orders/${order.id}`;
  if (!canCommitOnOrg(scope, order.organizationId)) redirect(`${back}?notice=cancel-not-allowed`);
  if (!viewAsCommitConfirmed(scope.workspace, order.organizationId, formData)) redirect(back);
  if (!reason) redirect(`${back}?notice=cancel-reason-required`);
  if (!canRequestCancellation(order)) redirect(`${back}?notice=cancel-unavailable`);

  const { count } = await prisma.order.updateMany({
    where: { id: order.id, cancellationRequestedAt: null, status: order.status },
    data: {
      cancellationRequestedAt: new Date(),
      cancellationRequestReason: reason,
      cancellationRequestedBy: scope.userId,
    },
  });
  if (count === 0) redirect(`${back}?notice=cancel-unavailable`);

  await recordAudit(scope.userId, "order.cancellation_requested", `Order:${order.id}`, {
    organizationId: order.organizationId,
    reason,
  });
  await notifyDesk({
    kind: "ORDER_CANCELLATION_REQUESTED",
    template: {
      key: "deskCancellationRequested",
      params: {
        orgName: order.organization.name,
        planName: order.quote.request.plan.name,
        orderId: order.id,
        reason,
      },
    },
  });

  revalidatePath(back);
  redirect(`${back}?notice=cancel-requested`);
}

// One-question post-order CSAT. Any member who can see the order may answer;
// one answer per order (the latest replaces it).
export async function submitOrderFeedback(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const orderId = str(formData, "orderId");
  const score = Number(str(formData, "score"));
  const comment = normalizeReason(formData.get("comment"));

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, organizationId: true },
  });
  if (!order) redirect(`/${locale}/requests`);

  const scope = await loadScope();
  if (!scope.userId || !canActOnOrg(scope, order.organizationId)) redirect(`/${locale}/signin`);
  const back = `/${locale}/orders/${order.id}`;
  if (!canEditOnOrg(scope, order.organizationId)) redirect(back);
  if (!isCsatScore(score) || !canGiveFeedback(order.status)) redirect(back);

  await prisma.orderFeedback.upsert({
    where: { orderId: order.id },
    create: { orderId: order.id, userId: scope.userId, score, comment },
    update: { userId: scope.userId, score, comment, createdAt: new Date() },
  });
  await recordAudit(scope.userId, "order.feedback_submitted", `Order:${order.id}`, {
    organizationId: order.organizationId,
    score,
  });

  revalidatePath(back);
  redirect(`${back}#feedback`);
}
