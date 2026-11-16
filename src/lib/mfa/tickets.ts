import { openJson, sealJson, signPayload, verifyPayload } from "./crypto";

// Two signed, short-lived values carry a sign-in across its second step.
//
// PENDING (httpOnly cookie, 5 min): "this browser passed the first factor
// for user X". It is NOT a session — no page or action treats it as one; its
// only use is to let /signin/mfa ask for the code without the password again.
//
// TICKET (30 s, never leaves the server): minted by a server action that has
// just verified everything, and handed in-process to the "session-ticket"
// Auth.js provider, which is the only thing that can turn it into a session.
// It pins the sessionVersion it was minted for, so it is void the moment the
// account is revoked again. A browser cannot obtain or forge one, so posting
// to /api/auth/callback/session-ticket directly gets nothing.

export const MFA_PENDING_COOKIE = "nativespin_mfa_pending";
export const MFA_PENDING_TTL_MS = 5 * 60_000;
const TICKET_TTL_MS = 30_000;

export type PendingMfa = {
  uid: string;
  /** Same-origin path to land on afterwards ("" = the role's home). */
  next: string;
  via: "password" | "magic";
};

export function signPending(p: PendingMfa, nowMs: number = Date.now()): string {
  return signPayload("mfa-pending", p, MFA_PENDING_TTL_MS, nowMs);
}

export function readPending(value: string | null | undefined, nowMs: number = Date.now()): PendingMfa | null {
  const p = verifyPayload<PendingMfa>("mfa-pending", value, nowMs);
  if (!p || typeof p.uid !== "string" || !p.uid) return null;
  return { uid: p.uid, next: typeof p.next === "string" ? p.next : "", via: p.via === "magic" ? "magic" : "password" };
}

export function mintSessionTicket(uid: string, sessionVersion: number, nowMs: number = Date.now()): string {
  return signPayload("session-ticket", { uid, sv: sessionVersion }, TICKET_TTL_MS, nowMs);
}

export function readSessionTicket(
  ticket: string | null | undefined,
  nowMs: number = Date.now(),
): { uid: string; sv: number } | null {
  const p = verifyPayload<{ uid: string; sv: number }>("session-ticket", ticket, nowMs);
  if (!p || typeof p.uid !== "string" || typeof p.sv !== "number") return null;
  return { uid: p.uid, sv: p.sv };
}

// Fresh recovery codes, between the action that generated them and the page
// that shows them once. Turning two-factor on bumps the session version, so
// the action must redirect (the new session cookie only takes effect on the
// next request) — and the codes cannot ride in the URL or sit in the database
// in plain text. So they travel in an ENCRYPTED httpOnly cookie that lives
// five minutes, is bound to the user id, and is deleted when the user
// confirms they saved them.
export const MFA_CODES_COOKIE = "nativespin_mfa_codes";
export const MFA_CODES_TTL_MS = 5 * 60_000;

export function sealRecoveryCodes(uid: string, codes: string[], nowMs: number = Date.now()): string {
  return sealJson("mfa-recovery-codes", { uid, codes }, MFA_CODES_TTL_MS, nowMs);
}

export function openRecoveryCodes(
  value: string | null | undefined,
  uid: string,
  nowMs: number = Date.now(),
): string[] | null {
  const p = openJson<{ uid: string; codes: string[] }>("mfa-recovery-codes", value, nowMs);
  if (!p || p.uid !== uid || !Array.isArray(p.codes)) return null;
  return p.codes.filter((c): c is string => typeof c === "string");
}

export function codesCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(MFA_CODES_TTL_MS / 1000),
  };
}

export function pendingCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(MFA_PENDING_TTL_MS / 1000),
  };
}
