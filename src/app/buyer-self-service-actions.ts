"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadScope, canActOnOrg, canEditOnOrg } from "@/lib/scope";
import { recordAudit } from "@/lib/audit";
import { notifyDesk } from "@/lib/notify";
import { VIEW_AS_CONFIRM_FIELD } from "@/lib/view-as";
import { canGiveFeedback, isCsatScore, normalizeReason } from "@/lib/buyer-self-service";
import {
  declineQuoteForBuyer,
  requestOrderCancellationForBuyer,
  withdrawRequestForBuyer,
} from "@/lib/buyer-self-service-db";

// Buyer self-service: backing out must be as easy as buying. The rules, the
// org-scope checks and the compare-and-set writes live in
// lib/buyer-self-service-db (tested against the database); these actions map
// each outcome to a redirect and send the audit row and the desk notice.

function viewAsConfirmField(formData: FormData): boolean {
  return formData.get(VIEW_AS_CONFIRM_FIELD) === "1";
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Decline a sent quote, with an optional reason (feeds win/loss reporting).
export async function declineQuote(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const reason = normalizeReason(formData.get("reason"));
  const scope = await loadScope();
  const r = await declineQuoteForBuyer(scope, str(formData, "quoteId"), reason, {
    viewAsConfirmed: viewAsConfirmField(formData),
  });
  if (r.outcome === "not-found") redirect(`/${locale}/requests`);
  if (r.outcome === "forbidden") redirect(`/${locale}/signin`);
  const back = `/${locale}/requests/${r.requestId}`;
  if (r.outcome === "not-allowed") redirect(`${back}?notice=decline-not-allowed`);
  if (r.outcome === "needs-confirm") redirect(back);
  if (r.outcome !== "declined") redirect(`${back}?notice=decline-unavailable`);

  await recordAudit(scope.userId, "quote.declined_by_buyer", `Quote:${r.quoteId}`, {
    requestId: r.requestId,
    organizationId: r.organizationId,
    reason,
  });
  await notifyDesk({
    kind: "QUOTE_DECLINED",
    template: {
      key: "deskQuoteDeclined",
      params: { orgName: r.orgName, planName: r.planName, requestId: r.requestId, reason },
    },
  });

  revalidatePath(back);
  redirect(`${back}?notice=quote-declined`);
}

// Withdraw a request the desk has not turned into an order.
export async function withdrawRequest(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const reason = normalizeReason(formData.get("reason"));
  const scope = await loadScope();
  const r = await withdrawRequestForBuyer(scope, str(formData, "requestId"), reason);
  if (r.outcome === "not-found") redirect(`/${locale}/requests`);
  if (r.outcome === "forbidden") redirect(`/${locale}/signin`);
  const back = `/${locale}/requests/${r.requestId}`;
  if (r.outcome === "not-allowed") redirect(`${back}?notice=withdraw-not-allowed`);
  if (r.outcome !== "withdrawn") redirect(`${back}?notice=withdraw-unavailable`);

  await recordAudit(scope.userId, "request.withdrawn_by_buyer", `Request:${r.requestId}`, {
    organizationId: r.organizationId,
    reason,
  });
  await notifyDesk({
    kind: "REQUEST_WITHDRAWN",
    template: {
      key: "deskRequestWithdrawn",
      params: { orgName: r.orgName, planName: r.planName, requestId: r.requestId, reason },
    },
  });

  revalidatePath(back);
  redirect(`${back}?notice=request-withdrawn`);
}

// Ask the desk to cancel a confirmed order. This is a REQUEST: the desk
// decides and runs cancelOrder itself. The order page shows the ask as
// pending meanwhile.
export async function requestOrderCancellation(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const reason = normalizeReason(formData.get("reason"));
  const scope = await loadScope();
  const r = await requestOrderCancellationForBuyer(scope, str(formData, "orderId"), reason, {
    viewAsConfirmed: viewAsConfirmField(formData),
  });
  if (r.outcome === "not-found") redirect(`/${locale}/requests`);
  if (r.outcome === "forbidden") redirect(`/${locale}/signin`);
  const back = `/${locale}/orders/${r.orderId}`;
  if (r.outcome === "not-allowed") redirect(`${back}?notice=cancel-not-allowed`);
  if (r.outcome === "needs-confirm") redirect(back);
  if (r.outcome === "reason-required") redirect(`${back}?notice=cancel-reason-required`);
  if (r.outcome !== "requested") redirect(`${back}?notice=cancel-unavailable`);

  await recordAudit(scope.userId, "order.cancellation_requested", `Order:${r.orderId}`, {
    organizationId: r.organizationId,
    reason,
  });
  await notifyDesk({
    kind: "ORDER_CANCELLATION_REQUESTED",
    template: {
      key: "deskCancellationRequested",
      params: { orgName: r.orgName, planName: r.planName, orderId: r.orderId, reason: r.reason },
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
