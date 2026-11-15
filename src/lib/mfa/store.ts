import { prisma } from "@/lib/prisma";
import {
  generateTotpSecret,
  verifyTotp,
  normalizeTotpCode,
} from "./totp";
import {
  encryptSecret,
  decryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
} from "./crypto";

// Database side of TOTP two-factor. No request scope in here (no cookies,
// headers or session) so every rule is testable against a real database:
// enrolment, single-use time-steps, single-use recovery codes, disabling.

export type MfaStatus = {
  enabled: boolean;
  /** A secret has been generated but no code confirmed yet. */
  pending: boolean;
  recoveryCodesLeft: number;
};

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  const [user, left] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabledAt: true, mfaSecretEnc: true },
    }),
    prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
  ]);
  const enabled = !!user?.mfaEnabledAt;
  return {
    enabled,
    pending: !enabled && !!user?.mfaSecretEnc,
    recoveryCodesLeft: enabled ? left : 0,
  };
}

export async function isMfaEnabled(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaEnabledAt: true },
  });
  return !!user?.mfaEnabledAt;
}

// Start (or restart) enrolment: a fresh secret, stored encrypted, NOT yet
// enabled. Refuses when two-factor is already on — replacing a live secret
// goes through disable, which demands a second proof.
export async function startEnrolment(userId: string): Promise<string | null> {
  const secret = generateTotpSecret();
  const updated = await prisma.user.updateMany({
    where: { id: userId, mfaEnabledAt: null },
    data: { mfaSecretEnc: encryptSecret(secret, userId), mfaLastStep: null },
  });
  return updated.count === 1 ? secret : null;
}

/** The not-yet-confirmed secret, for re-rendering the setup step. */
export async function pendingSecret(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaEnabledAt: true, mfaSecretEnc: true },
  });
  if (!user || user.mfaEnabledAt || !user.mfaSecretEnc) return null;
  return decryptSecret(user.mfaSecretEnc, userId);
}

export async function cancelEnrolment(userId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId, mfaEnabledAt: null },
    data: { mfaSecretEnc: null, mfaLastStep: null },
  });
}

async function replaceRecoveryCodes(
  tx: Pick<typeof prisma, "mfaRecoveryCode">,
  userId: string,
): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
  await tx.mfaRecoveryCode.createMany({
    data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c)! })),
  });
  return codes;
}

export type ConfirmEnrolmentResult =
  | { ok: true; recoveryCodes: string[]; sessionVersion: number }
  | { ok: false };

// Finish enrolment: the first valid code proves the authenticator holds the
// secret. Turns two-factor on, records the step (so that same code can't be
// reused to sign in), issues recovery codes, and bumps the session version so
// every session opened before two-factor existed ends.
export async function confirmEnrolment(
  userId: string,
  code: string,
  nowMs: number = Date.now(),
): Promise<ConfirmEnrolmentResult> {
  const secret = await pendingSecret(userId);
  if (!secret) return { ok: false };
  const step = verifyTotp(secret, code, nowMs);
  if (step === null) return { ok: false };

  return prisma.$transaction<ConfirmEnrolmentResult>(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: userId, mfaEnabledAt: null, mfaSecretEnc: { not: null } },
      data: {
        mfaEnabledAt: new Date(nowMs),
        mfaLastStep: step,
        sessionVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) return { ok: false };
    const recoveryCodes = await replaceRecoveryCodes(tx, userId);
    const row = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { sessionVersion: true },
    });
    return { ok: true, recoveryCodes, sessionVersion: row.sessionVersion };
  });
}

export type SecondFactorResult =
  | { ok: true; method: "totp" | "recovery"; recoveryCodesLeft: number }
  | { ok: false; reason: "not_enabled" | "invalid" | "replay" };

// Check a second factor for an account with two-factor ON. Six digits is a
// TOTP code; anything else is tried as a recovery code.
//
// Single use, both ways, decided by the database rather than by a read:
//   - TOTP: `mfaLastStep` only moves forward (UPDATE … WHERE mfaLastStep <
//     step), so a code that was accepted once — or an older one — loses the
//     race and is refused as a replay, even across concurrent requests.
//   - Recovery: UPDATE … WHERE usedAt IS NULL; one winner.
export async function verifySecondFactor(
  userId: string,
  rawCode: string,
  nowMs: number = Date.now(),
): Promise<SecondFactorResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaEnabledAt: true, mfaSecretEnc: true },
  });
  if (!user?.mfaEnabledAt || !user.mfaSecretEnc) return { ok: false, reason: "not_enabled" };

  if (normalizeTotpCode(rawCode)) {
    const secret = decryptSecret(user.mfaSecretEnc, userId);
    if (!secret) return { ok: false, reason: "invalid" };
    const step = verifyTotp(secret, rawCode, nowMs);
    if (step === null) return { ok: false, reason: "invalid" };
    const claimed = await prisma.user.updateMany({
      where: {
        id: userId,
        mfaEnabledAt: { not: null },
        OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }],
      },
      data: { mfaLastStep: step },
    });
    if (claimed.count !== 1) return { ok: false, reason: "replay" };
    const left = await prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
    return { ok: true, method: "totp", recoveryCodesLeft: left };
  }

  const hash = hashRecoveryCode(rawCode);
  if (!hash) return { ok: false, reason: "invalid" };
  const spent = await prisma.mfaRecoveryCode.updateMany({
    where: { userId, codeHash: hash, usedAt: null },
    data: { usedAt: new Date(nowMs) },
  });
  if (spent.count !== 1) return { ok: false, reason: "invalid" };
  const left = await prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
  return { ok: true, method: "recovery", recoveryCodesLeft: left };
}

/** New set of recovery codes; the old ones stop working. Caller proves a factor first. */
export async function regenerateRecoveryCodes(userId: string): Promise<string[] | null> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { mfaEnabledAt: true },
    });
    if (!user?.mfaEnabledAt) return null;
    return replaceRecoveryCodes(tx, userId);
  });
}

// Turn two-factor off and forget everything about it. Bumps the session
// version: whoever turned it off (the owner, or an admin running the
// break-glass script for a lost phone) ends every open session, so a session
// an attacker might be holding does not survive the downgrade.
// Returns the new session version, or null when it was not enabled.
export async function disableMfa(userId: string): Promise<number | null> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: userId, OR: [{ mfaEnabledAt: { not: null } }, { mfaSecretEnc: { not: null } }] },
      data: {
        mfaEnabledAt: null,
        mfaSecretEnc: null,
        mfaLastStep: null,
        sessionVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) return null;
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    const row = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { sessionVersion: true },
    });
    return row.sessionVersion;
  });
}
