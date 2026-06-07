// Tear down the scenario sandbox title/product created by
// scripts/create-test-title.ts. Reversible: sets active=false (does not
// delete) so any test order rows keep referential integrity but the title
// vanishes from the catalog + public API.
//
// Run: railway run --service Native sh -c \
//   "export DATABASE_URL='<Postgres DATABASE_PUBLIC_URL>'; pnpm tsx scripts/deactivate-test-title.ts"

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TITLE_SLUG = "zzz-test-scenario-sandbox";

async function main() {
  const title = await prisma.title.findUnique({
    where: { slug: TITLE_SLUG },
    include: { products: true },
  });
  if (!title) {
    console.log("No sandbox title found — nothing to do.");
    return;
  }
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

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
