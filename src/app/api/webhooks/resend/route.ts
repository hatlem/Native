import { NextRequest, NextResponse } from "next/server";
import { handleResendWebhook, WebhookError } from "@/lib/mail/resend-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inbound Resend webhook: bounces/complaints → OutreachSuppression.
// Configure in the Resend dashboard (Webhooks → add endpoint
// https://nativespin.com/api/webhooks/resend, events email.bounced +
// email.complained) and put the signing secret in RESEND_WEBHOOK_SECRET.
export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();
  try {
    const result = await handleResendWebhook({
      rawBody,
      headers: req.headers,
      secret: process.env.RESEND_WEBHOOK_SECRET,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WebhookError) {
      // 5xx for our own misconfiguration (missing secret) so Resend retries;
      // 4xx for a bad/forged request so it does not.
      console.error("resend_webhook.rejected", { reason: err.message });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("resend_webhook.error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
