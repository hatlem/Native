// Deletes consumed or expired auth tokens older than 30 days.
// Run on demand: `pnpm tsx scripts/cleanup-auth-tokens.ts`.
// Cron later if/when the tables grow.

import { prisma } from "@/lib/prisma";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function main() {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  const ml = await prisma.magicLinkToken.deleteMany({
    where: {
      OR: [{ consumedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
    },
  });

  const pr = await prisma.passwordResetToken.deleteMany({
    where: {
      OR: [{ consumedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
    },
  });

  console.log(`Cleaned up: magicLink=${ml.count} passwordReset=${pr.count}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
