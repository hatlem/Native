// Partner-webhook delivery (v0).
//
// Scope:
//  - Single delivery attempt per event per receiver.
//  - HMAC-SHA256 signature in `X-NativeSpin-Signature` header
//    over the raw JSON body, with the receiver's secret as the key.
//  - 5 s timeout; non-2xx → record `lastErrorAt` + `lastErrorBody`.
//  - No retry queue, no replay endpoint, no deduplication. Receivers
//    are expected to be idempotent on the `event_id` field in the body.
//
// What's NOT yet here (intentionally — tracked as Phase 3 follow-up):
//  - Retry-with-exponential-backoff via the Job queue.
//  - Signed replay endpoint (`POST /api/v1/webhooks/<id>/replay`).
//  - At-least-once delivery semantics + a partner-side replay tool.
//
// Use: fireWebhook("title.activated", { titleId, slug, name, marketCode }).
// Returns immediately — delivery runs in `after()` so the caller's
// response isn't blocked by a slow receiver. Errors are swallowed
// here; observability is via the PartnerWebhook row's lastErrorAt/Body.

import crypto from "node:crypto";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";

export type WebhookEventKind =
  | "title.activated"
  | "title.deactivated"
  | "title.price_changed";

export type WebhookPayload = {
  event_id: string; // cuid; receivers dedupe on this
  event_kind: WebhookEventKind;
  occurred_at: string; // ISO timestamp
  data: Record<string, unknown>;
};

const DELIVERY_TIMEOUT_MS = 5000;

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
      targets.map((wh) => deliverOnce(wh.id, wh.targetUrl, wh.secretHash, body)),
    );
  });
}

async function deliverOnce(
  id: string,
  url: string,
  secret: string,
  body: string,
): Promise<void> {
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NativeSpin-Signature": `sha256=${sig}`,
        "X-NativeSpin-Webhook-Id": id,
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 1000);
      await prisma.partnerWebhook.update({
        where: { id },
        data: {
          lastErrorAt: new Date(),
          lastErrorBody: `HTTP ${res.status}: ${text}`,
        },
      });
      return;
    }
    await prisma.partnerWebhook.update({
      where: { id },
      data: { lastDeliveryAt: new Date() },
    });
  } catch (err) {
    await prisma.partnerWebhook.update({
      where: { id },
      data: {
        lastErrorAt: new Date(),
        lastErrorBody: (err as Error).message?.slice(0, 1000) ?? "unknown",
      },
    }).catch(() => {
      /* swallow — we're already in error path */
    });
  } finally {
    clearTimeout(timer);
  }
}
