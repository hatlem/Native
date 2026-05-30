import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/tokens";

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type UpsertResult = { confirmRaw: string };

// Create or refresh a PENDING subscriber and return the RAW confirm token
// for the email URL. A fresh confirm token (and fresh 7-day expiry) is
// minted on every (re)subscribe. The unsub token hash is set once on
// create and never rotated, so any unsubscribe link stays valid for life.
//
// Raw tokens are never stored; the pre-confirmation email uses the confirm
// token for BOTH its confirm and unsubscribe links, and the unsubscribe
// route resolves either token. Durable per-send unsub tokens arrive with
// the newsletter-send sub-project (out of scope here).
export async function upsertPendingSubscriber(args: {
  email: string;
  locale: string;
  source: string;
}): Promise<UpsertResult> {
  const confirmRaw = generateToken();
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
      unsubTokenHash: hashToken(generateToken()),
    },
    update: {
      locale: args.locale,
      source: args.source,
      status: "PENDING",
      confirmTokenHash: hashToken(confirmRaw),
      confirmExpiresAt,
      confirmedAt: null,
      unsubscribedAt: null,
    },
  });

  return { confirmRaw };
}

// Confirm by raw token. Returns the subscriber locale on success (for the
// redirect), or null if the token is missing/expired/already used.
export async function confirmSubscriber(raw: string): Promise<{ locale: string } | null> {
  const row = await prisma.subscriber.findUnique({
    where: { confirmTokenHash: hashToken(raw) },
    select: { email: true, locale: true, confirmExpiresAt: true },
  });
  if (!row || !row.confirmExpiresAt || row.confirmExpiresAt < new Date()) return null;
  await prisma.subscriber.update({
    where: { email: row.email },
    data: { status: "CONFIRMED", confirmedAt: new Date(), confirmTokenHash: null, confirmExpiresAt: null },
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
