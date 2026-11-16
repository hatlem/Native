import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  openJson,
  sealJson,
  signPayload,
  verifyPayload,
  RECOVERY_CODE_COUNT,
} from "./crypto";
import {
  mintSessionTicket,
  openRecoveryCodes,
  sealRecoveryCodes,
  MFA_CODES_TTL_MS,
  readPending,
  readSessionTicket,
  signPending,
  MFA_PENDING_TTL_MS,
} from "./tickets";
import { staffMfaRequired, isStaffRole, mfaEnrolPath } from "./enforce";

process.env.AUTH_SECRET ||= "unit-test-secret-unit-test-secret";

test("encryptSecret: round-trips, and never stores the plaintext", () => {
  const enc = encryptSecret("JBSWY3DPEHPK3PXP", "user_1");
  assert.ok(enc.startsWith("v1."));
  assert.ok(!enc.includes("JBSWY3DPEHPK3PXP"));
  assert.equal(decryptSecret(enc, "user_1"), "JBSWY3DPEHPK3PXP");
});

test("encryptSecret: random IV — same input, different ciphertext", () => {
  assert.notEqual(encryptSecret("SECRET", "u"), encryptSecret("SECRET", "u"));
});

test("decryptSecret: bound to the user row, the key, and the exact bytes", () => {
  const enc = encryptSecret("SECRET", "user_1");
  // Copied onto another account's row.
  assert.equal(decryptSecret(enc, "user_2"), null);
  // AUTH_SECRET rotated.
  assert.equal(decryptSecret(enc, "user_1", "a-different-auth-secret"), null);
  // Tampered ciphertext.
  const parts = enc.split(".");
  const flipped = Buffer.from(parts[3], "base64url");
  flipped[0] ^= 1;
  parts[3] = flipped.toString("base64url");
  assert.equal(decryptSecret(parts.join("."), "user_1"), null);
  // Garbage.
  assert.equal(decryptSecret("plain-old-secret", "user_1"), null);
  assert.equal(decryptSecret("v2.a.b.c", "user_1"), null);
});

test("signPayload/verifyPayload: round-trip, expiry, tamper and purpose separation", () => {
  const now = 1_000_000;
  const token = signPayload("p1", { uid: "u1" }, 60_000, now);
  assert.equal(verifyPayload<{ uid: string }>("p1", token, now + 59_999)?.uid, "u1");
  assert.equal(verifyPayload("p1", token, now + 60_000), null); // expired
  assert.equal(verifyPayload("p2", token, now), null); // other purpose
  assert.equal(verifyPayload("p1", token, now, "other-secret"), null); // other key

  const [body, mac] = token.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ uid: "admin", exp: now + 60_000 })).toString("base64url");
  assert.equal(verifyPayload("p1", `${forgedBody}.${mac}`, now), null);
  assert.equal(verifyPayload("p1", `${body}.${mac.slice(0, -2)}xx`, now), null);
  assert.equal(verifyPayload("p1", body, now), null);
  assert.equal(verifyPayload("p1", "", now), null);
  assert.equal(verifyPayload("p1", null, now), null);
  assert.equal(verifyPayload("p1", "a.b.c", now), null);
});

test("pending cookie: carries uid/next/via for five minutes, then nothing", () => {
  const now = 5_000_000;
  const cookie = signPending({ uid: "u1", next: "/en/desk", via: "magic" }, now);
  assert.deepEqual(readPending(cookie, now + 1000), { uid: "u1", next: "/en/desk", via: "magic" });
  assert.equal(readPending(cookie, now + MFA_PENDING_TTL_MS), null);
  assert.equal(readPending("garbage", now), null);
  assert.equal(readPending(undefined, now), null);
});

test("a pending cookie is not a session ticket, and vice versa", () => {
  const now = 5_000_000;
  const cookie = signPending({ uid: "u1", next: "", via: "password" }, now);
  assert.equal(readSessionTicket(cookie, now), null);
  const ticket = mintSessionTicket("u1", 3, now);
  assert.equal(readPending(ticket, now), null);
});

test("session ticket: pins uid + session version, expires after 30 seconds", () => {
  const now = 9_000_000;
  const ticket = mintSessionTicket("u1", 7, now);
  assert.deepEqual(readSessionTicket(ticket, now + 29_000), { uid: "u1", sv: 7 });
  assert.equal(readSessionTicket(ticket, now + 30_000), null);
  assert.equal(readSessionTicket("", now), null);
});

test("recovery codes: ten distinct codes in xxxxx-xxxxx form", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, RECOVERY_CODE_COUNT);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) assert.match(c, /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
});

test("recovery code hashing: presentation-insensitive, never the code itself", () => {
  const [code] = generateRecoveryCodes(1);
  const hash = hashRecoveryCode(code)!;
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes(code.replace("-", "")));
  assert.equal(hashRecoveryCode(code.toUpperCase()), hash);
  assert.equal(hashRecoveryCode(code.replace("-", " ")), hash);
  assert.equal(hashRecoveryCode(` ${code} `), hash);
  assert.notEqual(hashRecoveryCode(generateRecoveryCodes(1)[0]), hash);
});

test("normalizeRecoveryCode: rejects anything that is not ten code characters", () => {
  assert.equal(normalizeRecoveryCode("abcde-fghjk"), "abcdefghjk");
  assert.equal(normalizeRecoveryCode("123456"), null); // that's a TOTP code
  assert.equal(normalizeRecoveryCode("abcde-fghj"), null);
  assert.equal(normalizeRecoveryCode(""), null);
  assert.equal(hashRecoveryCode("nope"), null);
});

test("staff requirement: off unless MFA_REQUIRED_FOR_STAFF=1", () => {
  assert.equal(staffMfaRequired({} as NodeJS.ProcessEnv), false);
  assert.equal(staffMfaRequired({ MFA_REQUIRED_FOR_STAFF: "0" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(staffMfaRequired({ MFA_REQUIRED_FOR_STAFF: "true" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(staffMfaRequired({ MFA_REQUIRED_FOR_STAFF: "1" } as unknown as NodeJS.ProcessEnv), true);
});

test("staff requirement: applies to DESK and SUPERADMIN only", () => {
  assert.equal(isStaffRole("DESK"), true);
  assert.equal(isStaffRole("SUPERADMIN"), true);
  for (const r of ["BUYER", "ORG_ADMIN", "PUBLISHER", "CONTENT", "APPROVER", null, undefined]) {
    assert.equal(isStaffRole(r), false);
  }
  assert.equal(mfaEnrolPath("no"), "/no/account/security?required=1");
});

test("sealJson/openJson: encrypted round-trip with expiry, purpose and key binding", () => {
  const now = 2_000_000;
  const sealed = sealJson("p1", { secret: "hunter2-visible?" }, 1000, now);
  assert.ok(!sealed.includes("hunter2"));
  assert.ok(!Buffer.from(sealed.split(".")[2], "base64url").toString().includes("hunter2"));
  assert.equal(openJson<{ secret: string }>("p1", sealed, now + 999)?.secret, "hunter2-visible?");
  assert.equal(openJson("p1", sealed, now + 1000), null);
  assert.equal(openJson("p2", sealed, now), null);
  assert.equal(openJson("p1", sealed, now, "another-secret"), null);
  assert.equal(openJson("p1", sealed.slice(0, -3) + "AAA", now), null);
  assert.equal(openJson("p1", "garbage", now), null);
  assert.equal(openJson("p1", undefined, now), null);
});

test("recovery-codes cookie: only its owner can open it, for five minutes", () => {
  const now = 3_000_000;
  const codes = ["abcde-fghjk", "mnpqr-stuvw"];
  const cookie = sealRecoveryCodes("user_1", codes, now);
  for (const c of codes) assert.ok(!cookie.includes(c));
  assert.deepEqual(openRecoveryCodes(cookie, "user_1", now + 1000), codes);
  assert.equal(openRecoveryCodes(cookie, "user_2", now + 1000), null);
  assert.equal(openRecoveryCodes(cookie, "user_1", now + MFA_CODES_TTL_MS), null);
  assert.equal(openRecoveryCodes(null, "user_1", now), null);
});
