// Partner-webhook delivery.
//
// Scope:
//  - Each event is queued once per receiver on the durable job queue
//    (lib/jobs, kind "webhook.deliver") and delivered by a worker. A failed
//    attempt (network error, timeout, 408, 429, 5xx) is retried with
//    exponential backoff for up to WEBHOOK_MAX_ATTEMPTS attempts (about two
//    hours); other 4xx are the receiver rejecting the payload and are not
//    retried. A delivery that runs out of attempts is dead-lettered: logged at
//    error level and listed on /desk/jobs, where it can be retried by hand.
//    Queued deliveries survive deploys and restarts.
//  - Signatures, both HMAC-SHA256 with the receiver's secret as the key:
//      X-NativeSpin-Signature:    sha256=<hex of HMAC(body)>            (v0, unchanged)
//      X-NativeSpin-Timestamp:    <unix seconds of this attempt>
//      X-NativeSpin-Signature-V1: sha256=<hex of HMAC(`${timestamp}.${body}`)>
//    New receivers should verify V1 and reject timestamps older than a few
//    minutes (replay protection); the v0 header stays so existing receivers
//    keep working.
//  - X-NativeSpin-Delivery-Id: stable across the retries of one event to one
//    receiver. X-NativeSpin-Delivery-Attempt: 1-based attempt number.
//  - 5 s timeout per attempt; each failure records `lastErrorAt` +
//    `lastErrorBody` on the PartnerWebhook row.
//  - Delivery is at-least-once: receivers must be idempotent on
//    X-NativeSpin-Delivery-Id or the `event_id` field in the body (both are
//    stable across retries).
//
// What's NOT here: a signed replay endpoint for receivers
// (`POST /api/v1/webhooks/<id>/replay`).
//
// Use: fireWebhook("title.activated", { titleId, slug, name, marketCode }).
// Returns immediately — queueing runs in `after()` so the caller's response
// isn't blocked.

import crypto from "node:crypto";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { enqueue, NonRetryableJobError, type JobContext } from "@/lib/jobs";
import { attempt } from "@/lib/webhooks-core";

export type WebhookEventKind =
  | "title.activated"
  | "title.deactivated"
  | "title.price_changed";

export type WebhookPayload = {
  event_id: string; // uuid; receivers dedupe on this
  event_kind: WebhookEventKind;
  occurred_at: string; // ISO timestamp
  data: Record<string, unknown>;
};

export const WEBHOOK_JOB_KIND = "webhook.deliver";
// 1, 2, 4, 8, 16, 32, 60 minutes between attempts → about two hours in all.
export const WEBHOOK_MAX_ATTEMPTS = 8;
export const WEBHOOK_BACKOFF_BASE_MS = 60_000;

export type WebhookJobPayload = {
  webhookId: string;
  eventId: string;
  eventKind: string;
  body: string;
};

// Queue one delivery per subscribed receiver. Exported for tests; callers use
// fireWebhook.
export async function queueWebhookEvent(
  kind: WebhookEventKind,
  data: Record<string, unknown>,
  opts: { kick?: boolean } = {},
): Promise<string[]> {
  const targets = await prisma.partnerWebhook.findMany({
    where: { disabledAt: null, events: { contains: kind } },
    select: { id: true },
  });
  if (targets.length === 0) return [];
  const event: WebhookPayload = {
    event_id: crypto.randomUUID(),
    event_kind: kind,
    occurred_at: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(event);
  const ids: string[] = [];
  for (const wh of targets) {
    const payload: WebhookJobPayload = { webhookId: wh.id, eventId: event.event_id, eventKind: kind, body };
    ids.push(
      await enqueue(WEBHOOK_JOB_KIND, payload, {
        idempotencyKey: `webhook:${event.event_id}:${wh.id}`,
        maxAttempts: WEBHOOK_MAX_ATTEMPTS,
        kick: opts.kick,
      }),
    );
  }
  return ids;
}

export function fireWebhook(
  kind: WebhookEventKind,
  data: Record<string, unknown>,
): void {
  // `after()` runs once the response is flushed; a failure here does not
  // affect the original action's success.
  after(async () => {
    try {
      await queueWebhookEvent(kind, data);
    } catch (err) {
      log.error("webhook.enqueue_failed", { eventKind: kind, err });
    }
  });
}

// The queued job: one attempt. Throwing makes the queue retry it later.
export async function runWebhookDeliveryJob(
  payload: WebhookJobPayload,
  ctx: JobContext,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const wh = await prisma.partnerWebhook.findUnique({ where: { id: payload.webhookId } });
  // Receiver removed or switched off since the event was queued: nothing to do.
  if (!wh || wh.disabledAt) return;

  const deliveryId = `${payload.eventId}.${wh.id}`;
  const res = await attempt(wh.id, wh.targetUrl, wh.secretHash, payload.body, ctx.attempt, fetchImpl, deliveryId);
  if (res.ok) {
    await prisma.partnerWebhook.update({ where: { id: wh.id }, data: { lastDeliveryAt: new Date() } });
    return;
  }
  await prisma.partnerWebhook.update({
    where: { id: wh.id },
    data: {
      lastErrorAt: new Date(),
      lastErrorBody: `${res.error} (attempt ${ctx.attempt} of ${ctx.maxAttempts})`.slice(0, 1000),
    },
  });
  log.warn("webhook.delivery_failed", {
    webhookId: wh.id,
    eventId: payload.eventId,
    eventKind: payload.eventKind,
    attempt: ctx.attempt,
    retryable: res.retryable,
    reason: res.error.slice(0, 300),
  });
  if (!res.retryable) throw new NonRetryableJobError(res.error);
  throw new Error(res.error);
}
