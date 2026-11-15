/**
 * Break-glass: turn two-factor authentication OFF for one user, by email.
 *
 * For a staff member (or customer) who has lost both their authenticator and
 * their recovery codes and is locked out. Clears the TOTP secret and the
 * recovery codes, bumps the session version (every open session on the
 * account ends) and writes an audit row. The user then signs in with their
 * password / email link alone — and, if MFA_REQUIRED_FOR_STAFF=1 and they are
 * DESK/SUPERADMIN, is sent straight to /account/security to enrol again.
 *
 * Verify the person's identity out of band BEFORE running this: it removes
 * the second factor from their account.
 *
 * Usage:
 *   pnpm tsx scripts/reset-mfa.ts <email> [--by <operator>]
 *
 * Against prod: prefix with the Railway public DB URL.
 *   DATABASE_URL="…" pnpm tsx scripts/reset-mfa.ts <email> --by andreas
 */

import { PrismaClient } from "@prisma/client";

async function main() {
  const args = process.argv.slice(2);
  const email = (args.find((a) => !a.startsWith("--")) ?? "").toLowerCase().trim();
  const byIdx = args.indexOf("--by");
  const operator = byIdx >= 0 ? args[byIdx + 1] : undefined;
  if (!email || (byIdx >= 0 && !operator)) {
    console.error("Usage: reset-mfa.ts <email> [--by <operator>]");
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, mfaEnabledAt: true, mfaSecretEnc: true },
    });
    if (!user) {
      console.error(`No user with email ${email}`);
      process.exit(1);
    }
    if (!user.mfaEnabledAt && !user.mfaSecretEnc) {
      console.log(`Two-factor is already off for ${email} (${user.role}). Nothing changed.`);
      return;
    }

    const codes = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          mfaEnabledAt: null,
          mfaSecretEnc: null,
          mfaLastStep: null,
          sessionVersion: { increment: 1 },
        },
      });
      const deleted = await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({
        data: {
          actor: operator ? `script:${operator}` : "script:reset-mfa",
          action: "auth.mfa_reset",
          entity: `User:${user.id}`,
          detail: JSON.stringify({ wasEnabled: !!user.mfaEnabledAt, role: user.role }),
        },
      });
      return deleted.count;
    });

    console.log(
      `Two-factor reset for ${email} (${user.role}): secret cleared, ${codes} recovery code(s) removed, all sessions ended.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
