// Tear down ALL scenario-test artifacts created during /run-scenarios:
//   1. Revoke the DB-minted orders:write test key(s).
//   2. Deactivate the sandbox title + products (reversible; keeps order FK).
// Run: railway run --service Postgres sh -c \
//   "export DATABASE_URL='$DATABASE_PUBLIC_URL'; pnpm tsx scripts/cleanup-scenario-test.ts"

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TITLE_SLUG = "zzz-test-scenario-sandbox";

async function main() {
  const revoked = await prisma.apiKey.updateMany({
    where: { name: { contains: "SCENARIO-TEST" }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  console.log(`Revoked ${revoked.count} scenario-test API key(s).`);

  const title = await prisma.title.findUnique({
    where: { slug: TITLE_SLUG },
    include: { products: true },
  });
  if (!title) {
    console.log("No sandbox title found.");
  } else {
    await prisma.product.updateMany({
      where: { titleId: title.id },
      data: { active: false, bookable: false },
    });
    await prisma.title.update({
      where: { id: title.id },
      data: {
        active: false,
        pricesPublic: false,
        discontinuedAt: new Date(),
        discontinuedNote: "Scenario sandbox — deactivated after /run-scenarios testing.",
      },
    });
    console.log(`Deactivated sandbox title ${title.id} (+${title.products.length} product(s)).`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
