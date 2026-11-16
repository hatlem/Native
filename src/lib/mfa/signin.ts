import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { RateLimiter } from "@/lib/rate-limit";
import {
  MFA_PENDING_COOKIE,
  pendingCookieOptions,
  readPending,
  signPending,
  type PendingMfa,
} from "./tickets";

// Request-scoped half of the second sign-in step: the pending cookie.

// Second-factor attempts at sign-in: a burst of 5, refilling over 5 minutes,
// per account and per IP — plus a slower per-account ceiling of 20 an hour. A
// 6-digit code with a ±1 step window has 3 valid values in 10^6, so even an
// attacker who already holds the password is kept to a negligible success
// rate (~0.15% per day of continuous guessing).
export const mfaLimiter = new RateLimiter(5, 5 / 300, undefined, undefined, "mfa-signin");
export const mfaHourlyLimiter = new RateLimiter(20, 20 / 3600, 2 * 60 * 60 * 1000, undefined, "mfa-signin-hourly");
// Signed-in two-factor management (confirm enrolment, regenerate, disable):
// its own bucket, so fumbling the setup doesn't lock the same person out of
// signing in.
export const mfaManageLimiter = new RateLimiter(10, 10 / 300, undefined, undefined, "mfa-manage");

export function mfaStepPath(locale: string): string {
  return `/${locale}/signin/mfa`;
}

// Called once the FIRST factor has been verified for `userId` (correct
// password, or a consumed magic link): remember that in a signed httpOnly
// cookie and return where the browser goes to finish signing in.
export async function beginMfaStep(args: {
  userId: string;
  email: string;
  locale: string;
  next: string;
  via: PendingMfa["via"];
  ip: string;
}): Promise<string> {
  const store = await cookies();
  store.set(
    MFA_PENDING_COOKIE,
    signPending({ uid: args.userId, next: args.next, via: args.via }),
    pendingCookieOptions(),
  );
  await recordAudit(args.userId, "auth.mfa_challenged", `User:${args.email}`, {
    ip: args.ip,
    via: args.via,
  });
  return mfaStepPath(args.locale);
}

export async function currentPendingMfa(): Promise<PendingMfa | null> {
  const store = await cookies();
  return readPending(store.get(MFA_PENDING_COOKIE)?.value);
}

export async function clearPendingMfa(): Promise<void> {
  const store = await cookies();
  store.delete(MFA_PENDING_COOKIE);
}

/** User id for an email whose password the credentials provider just accepted. */
export async function userIdForEmail(email: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return u?.id ?? null;
}
