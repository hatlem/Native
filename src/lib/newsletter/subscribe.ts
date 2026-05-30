"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { emailAdapter } from "@/lib/notify";
import { appUrl } from "@/lib/url";
import { RateLimiter } from "@/lib/rate-limit";
import { isSuppressed } from "@/lib/outreach/suppression";
import { parseSubscribeInput } from "./validate";
import { classifySubscribe } from "./classify";
import { buildConfirmEmail } from "./email";
import { upsertPendingSubscriber } from "./store";

export type SubscribeState = { status: "idle" | "ok" | "error"; message?: string };

const NEWSLETTER_FROM =
  process.env.AUTH_EMAIL_FROM ?? "NativeSpin <noreply@nativespin.com>";

// Throttle confirm-email sends so a re-submitted form can't be used to spam
// a third party's inbox. 5 sends per hour per email AND per source IP.
const subscribeLimiter = new RateLimiter(5, 5 / 3600);

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

export async function subscribeNewsletter(
  _prev: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  const locale = String(formData.get("locale") ?? "en");
  const parsed = parseSubscribeInput({
    email: String(formData.get("email") ?? ""),
    source: String(formData.get("source") ?? ""),
    website: String(formData.get("website") ?? ""),
  });

  // Honeypot → pretend success (don't tip off bots). Invalid → real error.
  if (!parsed.ok) {
    if (parsed.error === "honeypot") return { status: "ok" };
    return { status: "error", message: "invalid_email" };
  }

  const existing = await prisma.subscriber.findUnique({
    where: { email: parsed.email },
    select: { status: true },
  });
  const decision = classifySubscribe({
    existingStatus: existing?.status ?? null,
    suppressed: await isSuppressed(parsed.email),
  });

  if (decision === "SEND_CONFIRM") {
    // Rate-limit BEFORE we touch the row or send, so a flood can't keep
    // resetting a victim's subscriber row or mailbombing them. Over the
    // limit → behave like success without sending (no disclosure).
    const ip = await clientIp();
    const [emailCheck, ipCheck] = await Promise.all([
      subscribeLimiter.check(`newsletter:email:${parsed.email}`),
      subscribeLimiter.check(`newsletter:ip:${ip}`),
    ]);
    const okToSend = emailCheck.ok && ipCheck.ok;

    if (okToSend) {
      const { confirmRaw } = await upsertPendingSubscriber({
        email: parsed.email,
        locale,
        source: parsed.source,
      });
      const origin = appUrl(); // sync, returns origin (no trailing slash)
      const confirmUrl = `${origin}/api/newsletter/confirm?token=${confirmRaw}`;
      const unsubUrl = `${origin}/api/newsletter/unsubscribe?token=${confirmRaw}`;
      const msg = buildConfirmEmail({ confirmUrl, unsubUrl });
      try {
        await emailAdapter({ to: parsed.email, from: NEWSLETTER_FROM, ...msg });
      } catch (err) {
        // Row persists as PENDING; user still sees success and can re-submit
        // later to re-trigger the confirm send.
        console.error("newsletter.confirm_send_failed", err);
      }
    }
  }

  // Same success for SEND_CONFIRM and SILENT_OK — no existence disclosure.
  return { status: "ok" };
}
