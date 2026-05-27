/**
 * Promote a user to a specific role by email. Idempotent.
 *
 * Used to grant DESK / SUPERADMIN / CONTENT roles to test users so the
 * deferred internal-role scenarios (Petter, Henrik, Astrid, Ingrid,
 * Liv) can be exercised via `/testit` against the live product.
 *
 * Usage:
 *   pnpm tsx scripts/promote-to-desk.ts <email> <role>
 *
 * Examples:
 *   pnpm tsx scripts/promote-to-desk.ts andreas.hatlem+ns-petter@gmail.com DESK
 *   pnpm tsx scripts/promote-to-desk.ts andreas.hatlem+ns-ingrid@gmail.com SUPERADMIN
 *
 * Against prod: prefix with the Railway public DB URL.
 *   DATABASE_URL="$(railway variables -s Postgres --json | python3 -c '...')" \
 *     pnpm tsx scripts/promote-to-desk.ts <email> <role>
 */

import { PrismaClient, UserRole } from "@prisma/client";

const VALID_ROLES = Object.values(UserRole) as UserRole[];

async function main() {
  const [, , emailRaw, roleRaw] = process.argv;
  if (!emailRaw || !roleRaw) {
    console.error("Usage: promote-to-desk.ts <email> <role>");
    console.error(`Valid roles: ${VALID_ROLES.join(", ")}`);
    process.exit(2);
  }
  const email = emailRaw.toLowerCase();
  const role = roleRaw.toUpperCase() as UserRole;
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid role: ${roleRaw}. Valid: ${VALID_ROLES.join(", ")}`);
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, organizationId: true },
    });
    if (!user) {
      console.error(`User not found: ${email}`);
      console.error(
        `Sign up at https://nativespin.com/en/signup first, then re-run.`,
      );
      process.exit(1);
    }
    if (user.role === role) {
      console.log(
        `User ${email} already has role ${role} — nothing to do.`,
      );
      return;
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { role },
      select: { email: true, role: true },
    });
    console.log(
      `Promoted ${updated.email}: ${user.role} → ${updated.role}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
