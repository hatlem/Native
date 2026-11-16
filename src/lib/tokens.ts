import crypto from "node:crypto";

// 15-min TTL applies to both magic-link and password-reset tokens.
// One constant, one place — configurable TTLs invite drift.
export const AUTH_TOKEN_TTL_MIN = 15;

// 32 bytes → 256 bits of entropy → 43 base64url chars.
const TOKEN_BYTES = 32;

export function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function tokenExpiry(): Date {
  return new Date(Date.now() + AUTH_TOKEN_TTL_MIN * 60_000);
}

// ---- Invite tokens at rest ----
//
// Org and publisher invite links carry a random token; the database keeps
// only its SHA-256, so a leaked table yields no working invite link (same
// rule as the auth tokens above). The stored form is prefixed so it can never
// be confused with a raw token:
//
//   raw (in the emailed link)   base64url, never contains ":"
//   stored (column `token`)     "sha256:<hex>"
//
// Invites issued before this change are stored raw. `inviteTokenCandidates`
// therefore also matches the raw value — but never for an input that itself
// looks like a stored hash, so presenting a leaked "sha256:…" value as the
// token finds nothing. The raw fallback can be deleted once the last
// pre-change invite has expired (invites live 7–14 days).
const STORED_INVITE_PREFIX = "sha256:";

export function storedInviteToken(raw: string): string {
  return STORED_INVITE_PREFIX + hashToken(raw);
}

export function inviteTokenCandidates(raw: string): string[] {
  if (!raw) return [];
  if (raw.startsWith(STORED_INVITE_PREFIX)) return [storedInviteToken(raw)];
  return [storedInviteToken(raw), raw];
}
