// One-shot rebrand migration: rename demo users from @atnative.com to
// @nativespin.com and reset their passwords to the new convention. Run
// only when the DB still has the pre-rebrand demo accounts and the seed
// constants have moved on. After this runs, the demo chips on /signin
// (which reference @nativespin.com emails) will work again.
//
// Safe to re-run: skips users whose new-domain twin already exists.
//
// Usage: pnpm tsx scripts/migrate-rebrand-users.ts

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const MAPPING: Array<{ oldEmail: string; newEmail: string; password: string }> = [
  { oldEmail: "superadmin@atnative.com", newEmail: "superadmin@nativespin.com", password: "nativespin-superadmin" },
  { oldEmail: "desk@atnative.com", newEmail: "desk@nativespin.com", password: "nativespin-desk" },
  { oldEmail: "publisher@atnative.com", newEmail: "publisher@nativespin.com", password: "nativespin-pub" },
  { oldEmail: "buyer@atnative.com", newEmail: "buyer@nativespin.com", password: "nativespin-buyer" },
  { oldEmail: "agency@atnative.com", newEmail: "agency@nativespin.com", password: "nativespin-agency" },
];

async function main() {
  let migrated = 0;
  let skipped = 0;

  for (const { oldEmail, newEmail, password } of MAPPING) {
    const oldUser = await prisma.user.findUnique({ where: { email: oldEmail } });
    if (!oldUser) {
      console.log(`skip ${oldEmail} — not in DB`);
      skipped++;
      continue;
    }
    const newUser = await prisma.user.findUnique({ where: { email: newEmail } });
    if (newUser) {
      console.log(`skip ${oldEmail} — ${newEmail} already exists`);
      skipped++;
      continue;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: oldUser.id },
      data: { email: newEmail, passwordHash },
    });
    console.log(`migrated ${oldEmail} → ${newEmail}`);
    migrated++;
  }

  console.log(`\nDone: ${migrated} migrated, ${skipped} skipped.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
