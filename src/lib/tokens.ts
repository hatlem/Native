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
