// Token + invite-link helpers for the PublisherInvite flow.
//
// The token is a 128-bit cuid-like random — cryptographically strong
// enough for a single-use, time-limited link, and short enough to land
// in an email without wrapping. We don't reuse the User invite token
// scheme (we don't have one yet) and we keep this module pure so the
// claim-page guards can be tested without spinning Prisma.

import { randomBytes } from "node:crypto";

// Defaults — kept here so any future change (e.g. lengthening expiry
// after partnership feedback) is one number, not a search-and-replace.
const TOKEN_BYTES = 24; // 192 bits → ~32 url-safe characters
export const DEFAULT_INVITE_TTL_DAYS = 14;

export function newInviteToken(): string {
  // url-safe base64 without padding so the token survives copy/paste
  // and concatenates cleanly into a path segment.
  return randomBytes(TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function expiryFromNow(days: number = DEFAULT_INVITE_TTL_DAYS): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// Guard logic for the claim path. Pure — the caller passes the loaded
// row + the current time; this function says yes/no/why. Splitting it
// out means the test suite covers "expired", "already claimed", and
// "missing" without a DB.
export type InviteShape = {
  expiresAt: Date;
  claimedAt: Date | null;
};

export type InviteVerdict =
  | { ok: true }
  | { ok: false; reason: "expired" | "claimed" };

export function checkInvite(
  invite: InviteShape | null | undefined,
  now: Date = new Date(),
): InviteVerdict | null {
  if (!invite) return null;
  if (invite.claimedAt) return { ok: false, reason: "claimed" };
  if (invite.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

// Site origin for absolute links in outbound email. Reads
// NEXT_PUBLIC_SITE_URL when present (set in production); falls back to
// the dev URL so local emails are still clickable.
export function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    "http://localhost:3000"
  );
}

export function claimLink(token: string, locale: string = "en"): string {
  // Same domain, /<locale>/publisher/claim/<token> — see the page at
  // src/app/[locale]/publisher/claim/[token]/page.tsx.
  return `${siteOrigin()}/${locale}/publisher/claim/${encodeURIComponent(token)}`;
}

export function inviteEmail(args: {
  publisherName: string;
  inviterName?: string | null;
  link: string;
}): { subject: string; text: string } {
  const subject = `NativeSpin — partnership invitation for ${args.publisherName}`;
  const lines = [
    `Hi,`,
    ``,
    `${args.inviterName ?? "The NativeSpin team"} has added ${args.publisherName} to the NativeSpin catalog and invited you to claim a publisher portal account.`,
    ``,
    `The portal lets you maintain rate cards, specs, availability, and bookings for the titles NativeSpin buyers can book through us.`,
    ``,
    `Claim the account here (link expires in ${DEFAULT_INVITE_TTL_DAYS} days):`,
    args.link,
    ``,
    `If you weren't expecting this, you can ignore the message — the link is single-use.`,
    ``,
    `— NativeSpin`,
  ];
  return { subject, text: lines.join("\n") };
}
