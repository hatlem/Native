// Single-use auth-token consumption. Both consumers use the same
// atomic-guard pattern: updateMany with `consumedAt: null` + unexpired
// in the WHERE clause, so a double-click race resolves to exactly one
// winner (only one caller sees count === 1).
//
// Extracted from the magic-link Credentials provider (src/auth.ts) and
// the resetPassword action so the semantics are testable against a real
// database without a request scope.

import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";

export type ConsumedMagicLinkUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  orgId: string | null;
  orgType: string | null;
};

// Consume a magic-link token: atomically mark it used, then resolve the
// owning user. First successful consume also stamps emailVerifiedAt —
// clicking the link in the inbox is the proof of mailbox ownership.
// Returns null for unknown / already-used / expired tokens.
export async function consumeMagicLinkToken(
  raw: string,
): Promise<ConsumedMagicLinkUser | null> {
  if (!raw) return null;
  const hash = hashToken(raw);

  const updated = await prisma.magicLinkToken.updateMany({
    where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (updated.count !== 1) return null;

  const row = await prisma.magicLinkToken.findUnique({
    where: { tokenHash: hash },
    include: {
      user: {
        include: { organization: { select: { id: true, type: true } } },
      },
    },
  });
  if (!row) return null;

  // A deactivated account cannot be signed into, by any route. The token is
  // already burnt at this point (the atomic consume above), which is what we
  // want: a stale link in an off-boarded user's inbox is spent, not reusable.
  if (row.user.deactivatedAt) return null;

  if (!row.user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: row.userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  return {
    id: row.user.id,
    email: row.user.email,
    name: row.user.name,
    role: row.user.role,
    orgId: row.user.organization?.id ?? null,
    orgType: row.user.organization?.type ?? null,
  };
}

export type PasswordResetOutcome =
  | { ok: true; userId: string; email: string }
  | { ok: false };

// Consume a password-reset token and apply the new password hash in one
// transaction. Every other open reset token for the same user is
// invalidated so a stale email link can't undo the change later.
export async function consumePasswordResetToken(
  raw: string,
  newPasswordHash: string,
): Promise<PasswordResetOutcome> {
  if (!raw) return { ok: false };
  const hash = hashToken(raw);
  const now = new Date();

  return prisma.$transaction<PasswordResetOutcome>(async (tx) => {
    const updated = await tx.passwordResetToken.updateMany({
      where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (updated.count !== 1) return { ok: false };

    const row = await tx.passwordResetToken.findUnique({
      where: { tokenHash: hash },
      select: { userId: true, user: { select: { email: true } } },
    });
    if (!row) return { ok: false };

    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash: newPasswordHash },
    });

    await tx.passwordResetToken.updateMany({
      where: { userId: row.userId, consumedAt: null, NOT: { tokenHash: hash } },
      data: { consumedAt: now },
    });

    return { ok: true, userId: row.userId, email: row.user.email };
  });
}

export type EmailChangeOutcome =
  | { ok: true; userId: string; oldEmail: string; newEmail: string }
  | { ok: false; reason: "expired" | "taken" };

// Consume an email-change token: validate, re-check that the address is
// still free, move it, and invalidate the user's other open change tokens.
//
// The free-address check has to happen HERE, not only when the change was
// requested: two people can each hold a pending token for the same address
// (nothing reserves it), and the loser must be told rather than crashing on
// the unique index. The P2002 catch closes the last sliver of that race —
// two confirmations landing in the same millisecond.
//
// Clicking the link is proof of mailbox ownership, so the move also stamps
// emailVerifiedAt: an account whose address just changed is verified against
// the new address, never carrying the old one's verification forward
// implicitly.
export async function consumeEmailChangeToken(
  raw: string,
): Promise<EmailChangeOutcome> {
  if (!raw) return { ok: false, reason: "expired" };
  const hash = hashToken(raw);
  const now = new Date();

  try {
    return await prisma.$transaction<EmailChangeOutcome>(async (tx) => {
      const updated = await tx.emailChangeToken.updateMany({
        where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (updated.count !== 1) return { ok: false, reason: "expired" };

      const row = await tx.emailChangeToken.findUnique({
        where: { tokenHash: hash },
        select: {
          userId: true,
          newEmail: true,
          user: { select: { email: true } },
        },
      });
      if (!row) return { ok: false, reason: "expired" };

      const taken = await tx.user.findUnique({
        where: { email: row.newEmail },
        select: { id: true },
      });
      if (taken && taken.id !== row.userId) {
        return { ok: false, reason: "taken" };
      }

      await tx.user.update({
        where: { id: row.userId },
        data: { email: row.newEmail, emailVerifiedAt: now },
      });

      await tx.emailChangeToken.updateMany({
        where: { userId: row.userId, consumedAt: null, NOT: { tokenHash: hash } },
        data: { consumedAt: now },
      });

      return {
        ok: true,
        userId: row.userId,
        oldEmail: row.user.email,
        newEmail: row.newEmail,
      };
    });
  } catch (err) {
    // Unique violation on User.email — someone else won the same address
    // between the check above and the write.
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "P2002"
    ) {
      return { ok: false, reason: "taken" };
    }
    throw err;
  }
}
