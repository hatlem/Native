import crypto from "node:crypto";

// Key material for two-factor, all derived from AUTH_SECRET with HKDF so one
// leaked derived key says nothing about the others (or about the JWT key):
//   - "totp-secret-v1"  AES-256-GCM key encrypting TOTP secrets at rest
//   - "signed-v1"       HMAC key for the pending-MFA cookie and the
//                       server-internal session ticket
// Rotating AUTH_SECRET therefore invalidates stored TOTP secrets — affected
// users re-enrol (scripts/reset-mfa.ts clears a stuck account).

const SALT = "nativespin-mfa";

function authSecret(): string {
  const s = process.env.AUTH_SECRET ?? "";
  if (!s) throw new Error("AUTH_SECRET is required for two-factor authentication");
  return s;
}

function deriveKey(info: string, secret: string = authSecret()): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", secret, SALT, info, 32));
}

// ── TOTP secret at rest ────────────────────────────────────────────────────
// Format: v1.<iv>.<tag>.<ciphertext>, base64url parts. The user id is bound
// in as AAD so a ciphertext copied onto another row will not decrypt.

export function encryptSecret(plain: string, userId: string, secret?: string): string {
  const key = deriveKey("totp-secret-v1", secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(userId));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(enc: string, userId: string, secret?: string): string | null {
  const parts = enc.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const key = deriveKey("totp-secret-v1", secret);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key (AUTH_SECRET rotated), wrong row, or tampered value.
    return null;
  }
}

// ── Signed, expiring payloads ──────────────────────────────────────────────
// `purpose` is part of the MAC input, so a pending-MFA cookie can never be
// replayed as a session ticket or vice versa.

export function signPayload(
  purpose: string,
  payload: Record<string, unknown>,
  ttlMs: number,
  nowMs: number = Date.now(),
  secret?: string,
): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: nowMs + ttlMs })).toString("base64url");
  const mac = crypto
    .createHmac("sha256", deriveKey("signed-v1", secret))
    .update(`${purpose}.${body}`)
    .digest("base64url");
  return `${body}.${mac}`;
}

export function verifyPayload<T extends Record<string, unknown>>(
  purpose: string,
  token: string | null | undefined,
  nowMs: number = Date.now(),
  secret?: string,
): (T & { exp: number }) | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  const mac = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(
    crypto
      .createHmac("sha256", deriveKey("signed-v1", secret))
      .update(`${purpose}.${body}`)
      .digest("base64url"),
  );
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof parsed.exp !== "number" || parsed.exp <= nowMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Sealed (encrypted + expiring) values ──────────────────────────────────
// For the one thing that has to survive a redirect without being readable or
// stored server-side in plain text: the freshly generated recovery codes on
// their way to the "save these" screen. AES-256-GCM under its own derived
// key; `purpose` is bound in as AAD.

export function sealJson(
  purpose: string,
  payload: Record<string, unknown>,
  ttlMs: number,
  nowMs: number = Date.now(),
  secret?: string,
): string {
  const key = deriveKey("sealed-v1", secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const ct = Buffer.concat([
    cipher.update(JSON.stringify({ ...payload, exp: nowMs + ttlMs }), "utf8"),
    cipher.final(),
  ]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function openJson<T extends Record<string, unknown>>(
  purpose: string,
  sealed: string | null | undefined,
  nowMs: number = Date.now(),
  secret?: string,
): (T & { exp: number }) | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 3) return null;
  try {
    const key = deriveKey("sealed-v1", secret);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "base64url"));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(Buffer.from(parts[1], "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(parts[2], "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plain) as T & { exp: number };
    if (typeof parsed.exp !== "number" || parsed.exp <= nowMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Recovery codes ─────────────────────────────────────────────────────────
// 10 codes of 50 random bits each ("abcde-fghij", Crockford-ish alphabet with
// no 0/o/1/l/i). High entropy, so a plain SHA-256 at rest is sufficient —
// there is nothing to brute-force offline that a slow hash would save.

export const RECOVERY_CODE_COUNT = 10;
const RC_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // 31 symbols

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let s = "";
    for (let j = 0; j < 10; j++) s += RC_ALPHABET[crypto.randomInt(RC_ALPHABET.length)];
    codes.push(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return codes;
}

/** Case, spaces and the dash are presentation: "ABCDE fghij" is the same code. */
export function normalizeRecoveryCode(raw: string): string | null {
  const clean = raw.toLowerCase().replace(/[\s-]/g, "");
  return /^[a-z2-9]{10}$/.test(clean) ? clean : null;
}

export function hashRecoveryCode(raw: string): string | null {
  const clean = normalizeRecoveryCode(raw);
  if (!clean) return null;
  return crypto.createHash("sha256").update(`mfa-recovery:${clean}`).digest("hex");
}
