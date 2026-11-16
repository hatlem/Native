import crypto from "node:crypto";

// RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30-second steps) — the profile every
// authenticator app speaks. Implemented on node:crypto so two-factor adds no
// dependency. Pure: no I/O, no clock unless the caller omits `now`.

export const TOTP_PERIOD_SEC = 30;
export const TOTP_DIGITS = 6;
// Accept the step before and after "now": covers a phone clock that is up to
// ~30s off and a code typed right as it rolls over.
export const TOTP_WINDOW = 1;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

// Lenient on what people paste (lower case, spaces, dashes, padding), strict
// on the alphabet: an invalid character returns null rather than a wrong key.
export function base32Decode(input: string): Buffer | null {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  if (!clean) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, the RFC 4226 recommended length, as base32. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function timeStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SEC);
}

export function totpAt(secretBase32: string, step: number): string | null {
  const key = base32Decode(secretBase32);
  if (!key) return null;
  return hotp(key, step);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** "123 456" / "123-456" → "123456"; anything that is not 6 digits → null. */
export function normalizeTotpCode(raw: string): string | null {
  const clean = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(clean) ? clean : null;
}

// The time-step a code matches within the window, or null. Returning the
// step (not a boolean) is what lets the caller refuse a replay: it persists
// the highest accepted step and rejects anything at or below it.
export function verifyTotp(
  secretBase32: string,
  rawCode: string,
  nowMs: number = Date.now(),
  window: number = TOTP_WINDOW,
): number | null {
  const code = normalizeTotpCode(rawCode);
  const key = base32Decode(secretBase32);
  if (!code || !key) return null;
  const current = timeStep(nowMs);
  let matched: number | null = null;
  // No early exit: every candidate is compared so timing doesn't reveal
  // which step (if any) matched.
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    if (step < 0) continue;
    if (safeEqual(hotp(key, step), code)) matched = step;
  }
  return matched;
}

/** otpauth:// provisioning URI understood by authenticator apps. */
export function otpauthUri(args: {
  secretBase32: string;
  account: string;
  issuer: string;
}): string {
  const label = `${encodeURIComponent(args.issuer)}:${encodeURIComponent(args.account)}`;
  const q = new URLSearchParams({
    secret: args.secretBase32,
    issuer: args.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** "ABCDEFGH…" → "ABCD EFGH …" for reading off a screen. */
export function groupSecret(secretBase32: string): string {
  return secretBase32.replace(/(.{4})/g, "$1 ").trim();
}
