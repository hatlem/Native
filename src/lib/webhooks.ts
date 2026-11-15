// Partner-webhook delivery.
//
// Scope:
//  - Up to MAX_ATTEMPTS delivery attempts per event per receiver, with
//    exponential backoff (RETRY_DELAYS_MS in webhooks-core.ts), for network errors, timeouts,
//    408, 429 and 5xx. Other 4xx are the receiver rejecting the payload and
//    are not retried.
//  - Signatures, both HMAC-SHA256 with the receiver's secret as the key:
//      X-NativeSpin-Signature:    sha256=<hex of HMAC(body)>            (v0, unchanged)
//      X-NativeSpin-Timestamp:    <unix seconds of this attempt>
//      X-NativeSpin-Signature-V1: sha256=<hex of HMAC(`${timestamp}.${body}`)>
//    New receivers should verify V1 and reject timestamps older than a few
//    minutes (replay protection); the v0 header stays so existing receivers
//    keep working.
//  - X-NativeSpin-Delivery-Attempt: 1-based attempt number.
//  - 5 s timeout per attempt; a final failure records `lastErrorAt` +
//    `lastErrorBody` on the PartnerWebhook row and logs `webhook.delivery_failed`.
//  - Delivery is therefore at-least-once: receivers must be idempotent on the
//    `event_id` field in the body (it is stable across retries).
//
// What's NOT here: retries are in-process (inside `after()`), so an event is
// still lost if the process dies mid-backoff. A durable queue + a signed
// replay endpoint (`POST /api/v1/webhooks/<id>/replay`) remain follow-ups.
//
// Use: fireWebhook("title.activated", { titleId, slug, name, marketCode }).
// Returns immediately — delivery runs in `after()` so the caller's
// response isn't blocked by a slow receiver.

import crypto from "node:crypto";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { deliverWithRetry } from "@/lib/webhooks-core";

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

export function fireWebhook(
  kind: WebhookEventKind,
  data: Record<string, unknown>,
): void {
  // Fan-out in `after()` so the user-facing request returns immediately.
  // `after()` runs after the response is flushed; failures here do not
  // affect the original action's success.
  after(async () => {
    const event: WebhookPayload = {
      event_id: crypto.randomUUID(),
      event_kind: kind,
      occurred_at: new Date().toISOString(),
      data,
    };
    const body = JSON.stringify(event);

    const targets = await prisma.partnerWebhook.findMany({
      where: {
        disabledAt: null,
        events: { contains: kind },
      },
    });
    if (targets.length === 0) return;

    await Promise.all(
      targets.map((wh) => deliver(wh.id, wh.targetUrl, wh.secretHash, body, event)),
    );
  });
}

async function deliver(
  id: string,
  url: string,
  secret: string,
  body: string,
  event: WebhookPayload,
): Promise<void> {
  const outcome = await deliverWithRetry(id, url, secret, body);
  try {
    if (outcome.ok) {
      await prisma.partnerWebhook.update({
        where: { id },
        data: { lastDeliveryAt: new Date() },
      });
      return;
    }
    log.warn("webhook.delivery_failed", {
      webhookId: id,
      eventId: event.event_id,
      eventKind: event.event_kind,
      attempts: outcome.attempts,
      reason: outcome.error,
    });
    await prisma.partnerWebhook.update({
      where: { id },
      data: {
        lastErrorAt: new Date(),
        lastErrorBody: `${outcome.error ?? "unknown"} (after ${outcome.attempts} attempt${outcome.attempts === 1 ? "" : "s"})`.slice(0, 1000),
      },
    });
  } catch (err) {
    // Bookkeeping failure must not surface: we are in `after()`.
    log.error("webhook.bookkeeping_failed", { webhookId: id, err });
  }
}
