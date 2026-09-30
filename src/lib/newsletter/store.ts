import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/tokens";
import { newsletterUnsubToken } from "./links";

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type UpsertResult = { confirmRaw: string; unsubRaw: string };

// Create or refresh a PENDING subscriber and return the RAW tokens for the
// email URLs. A fresh confirm token (and fresh 7-day expiry) is minted on
// every (re)subscribe. The unsubscribe token is deterministic per address
// (see ./links), so the one in this email keeps working after the confirm
// click and across re-subscribes — and every future send can carry it too.
// Only hashes are stored.
export async function upsertPendingSubscriber(args: {
  email: string;
  locale: string;
  source: string;
}): Promise<UpsertResult> {
  const confirmRaw = generateToken();
  const unsubRaw = newsletterUnsubToken(args.email);
  const unsubTokenHash = hashToken(unsubRaw);
  const confirmExpiresAt = new Date(Date.now() + CONFIRM_TTL_MS);

  await prisma.subscriber.upsert({
    where: { email: args.email },
    create: {
      email: args.email,
      locale: args.locale,
      source: args.source,
      status: "PENDING",
      confirmTokenHash: hashToken(confirmRaw),
      confirmExpiresAt,
      unsubTokenHash,
    },
    update: {
      locale: args.locale,
      source: args.source,
      status: "PENDING",
      confirmTokenHash: hashToken(confirmRaw),
      confirmExpiresAt,
      confirmedAt: null,
      unsubscribedAt: null,
      // Rows created before the deterministic token carry a random hash
      // nobody holds the raw value for; converge them here.
      unsubTokenHash,
    },
  });

  return { confirmRaw, unsubRaw };
}

// Confirm by raw token. Returns the subscriber locale on success (for the
// redirect), or null if the token is unknown or expired.
//
// The confirm hash is KEPT after confirming (only the expiry is cleared):
// confirmation emails sent before the durable unsubscribe token existed
// used this token for their opt-out link too, and the unsubscribe route
// still resolves it. Clicking Confirm must not kill the opt-out link in the
// same email. A second click on an already-confirmed row is idempotent.
export async function confirmSubscriber(raw: string): Promise<{ locale: string } | null> {
  const row = await prisma.subscriber.findUnique({
    where: { confirmTokenHash: hashToken(raw) },
    select: { email: true, locale: true, status: true, confirmExpiresAt: true },
  });
  if (!row) return null;
  if (row.status === "CONFIRMED") return { locale: row.locale };
  if (row.status !== "PENDING" || !row.confirmExpiresAt || row.confirmExpiresAt < new Date()) {
    return null;
  }
  await prisma.subscriber.update({
    where: { email: row.email },
    data: { status: "CONFIRMED", confirmedAt: new Date(), confirmExpiresAt: null },
  });
  return { locale: row.locale };
}

// Unsubscribe by raw token. Idempotent. Returns locale or null.
export async function unsubscribeSubscriber(raw: string): Promise<{ locale: string } | null> {
  const row = await prisma.subscriber.findUnique({
    where: { unsubTokenHash: hashToken(raw) },
    select: { email: true, locale: true },
  });
  if (!row) return null;
  await prisma.subscriber.update({
    where: { email: row.email },
    data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
  });
  return { locale: row.locale };
}
