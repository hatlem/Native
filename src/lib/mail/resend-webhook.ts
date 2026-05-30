// Inbound Resend webhook handling — turns bounce/complaint events into
// OutreachSuppression rows so we never re-send to a dead or hostile address.
//
// Resend signs webhooks with Svix. We verify the signature manually (same
// node:crypto approach as src/lib/webhooks.ts) rather than pull in the `svix`
// dependency. The signed content is `${id}.${timestamp}.${rawBody}` and the
// secret is the base64 payload after the `whsec_` prefix.
//
// Route stays thin (src/app/api/webhooks/resend/route.ts); all logic lives
// here so it is unit-testable without spinning up Next.
import crypto from "node:crypto";
import { addSuppression } from "@/lib/outreach/suppression";

const TIMESTAMP_TOLERANCE_S = 300; // reject anything older/newer than 5 min (replay guard)

export type SvixHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export function extractSvixHeaders(headers: Headers): SvixHeaders {
  return {
    id: headers.get("svix-id"),
    timestamp: headers.get("svix-timestamp"),
    signature: headers.get("svix-signature"),
  };
}

/**
 * Verify a Svix-signed webhook. Returns true only when a v1 signature matches
 * and the timestamp is within tolerance. Constant-time compare; never throws.
 */
export function verifySvixSignature(args: {
  secret: string;
  payload: string;
  headers: SvixHeaders;
  nowMs?: number;
}): boolean {
  const { secret, payload, headers } = args;
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;

  // Replay guard.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowS = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowS - ts) > TIMESTAMP_TOLERANCE_S) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  const expectedBuf = Buffer.from(expected);

  // Header is a space-separated list of `v1,<sig>` entries — match any.
  for (const part of signature.split(" ")) {
    const comma = part.indexOf(",");
    const sig = comma === -1 ? part : part.slice(comma + 1);
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

export type ResendEvent = {
  type: string;
  data?: {
    to?: string | string[];
    bounce?: { type?: string; subType?: string } | null;
  };
};

/**
 * Which recipients should be suppressed for this event, and why.
 *  - complaints (spam reports): always suppress.
 *  - bounces: suppress only PERMANENT/hard bounces — a transient bounce
 *    (full mailbox, greylisting) may clear, so we don't burn the address.
 * Everything else (delivered, opened, …) yields no suppressions.
 */
export function suppressionsFromEvent(event: ResendEvent): { email: string; reason: string }[] {
  const recipients = toRecipientList(event.data?.to);
  if (recipients.length === 0) return [];

  if (event.type === "email.complained") {
    return recipients.map((email) => ({ email, reason: "complaint" }));
  }

  if (event.type === "email.bounced") {
    const bounceType = event.data?.bounce?.type?.toLowerCase();
    // Resend marks hard bounces as "Permanent"; treat unknown as permanent
    // (a bare email.bounced with no subtype is a hard bounce in practice).
    const transient = bounceType === "transient" || bounceType === "soft";
    if (transient) return [];
    return recipients.map((email) => ({ email, reason: "bounce" }));
  }

  return [];
}

function toRecipientList(to: string | string[] | undefined): string[] {
  if (!to) return [];
  return (Array.isArray(to) ? to : [to]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Full handler: verify, parse, suppress. Returns a small summary for the
 * route to log/return. Throws only on a verification/parse failure the route
 * should turn into a 4xx.
 */
export async function handleResendWebhook(args: {
  rawBody: string;
  headers: Headers;
  secret: string | undefined;
  nowMs?: number;
}): Promise<{ ok: true; suppressed: number; type: string } > {
  if (!args.secret) throw new WebhookError("missing_secret", 500);

  const svix = extractSvixHeaders(args.headers);
  if (!verifySvixSignature({ secret: args.secret, payload: args.rawBody, headers: svix, nowMs: args.nowMs })) {
    throw new WebhookError("invalid_signature", 400);
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(args.rawBody);
  } catch {
    throw new WebhookError("invalid_json", 400);
  }

  const suppressions = suppressionsFromEvent(event);
  for (const s of suppressions) {
    await addSuppression(s);
  }
  return { ok: true, suppressed: suppressions.length, type: event.type ?? "unknown" };
}

export class WebhookError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
