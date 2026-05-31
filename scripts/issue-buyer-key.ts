import { prisma } from "@/lib/prisma";
import { generateApiToken, hashApiToken } from "@/lib/api-key";

// Issue an API key bound to a buying Organization, scoped for catalog sync
// + self-serve order placement. Desk-issued only (run by an operator) —
// there is no self-service key UI by design.
async function main() {
  const [orgRef, name = "API buyer key"] = process.argv.slice(2);
  if (!orgRef) {
    console.error("usage: tsx scripts/issue-buyer-key.ts <orgId|orgName> [name]");
    process.exit(1);
  }
  const org = await prisma.organization.findFirst({
    where: { OR: [{ id: orgRef }, { name: orgRef }] },
  });
  if (!org) {
    console.error("organization not found:", orgRef);
    process.exit(1);
  }
  const superadmin = await prisma.user.findFirst({
    where: { role: "SUPERADMIN" },
    select: { id: true },
  });
  if (!superadmin) {
    console.error("no superadmin user found to own the key");
    process.exit(1);
  }
  const token = generateApiToken();
  const key = await prisma.apiKey.create({
    data: {
      name,
      scopes: "catalog:read,orders:write",
      tokenHash: hashApiToken(token),
      createdBy: superadmin.id,
      organizationId: org.id,
    },
  });
  console.log("Issued key", key.id, "for organization", org.name);
  console.log("Scopes: catalog:read,orders:write");
  console.log("TOKEN (shown once):", token);
  await prisma.$disconnect();
}

main();
