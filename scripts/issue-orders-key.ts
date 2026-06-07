// TEST-ONLY: mint an org-bound catalog:read,orders:write key by direct DB
// insert. This DELIBERATELY bypasses createApiKey's VALID_SCOPES allowlist
// (which does NOT include orders:write — so the supported issuance flow
// cannot produce this key). Used only to prove POST /api/v1/orders works
// end-to-end during scenario testing. Revoke after.
//
// Run: railway run --service Postgres sh -c \
//   "export DATABASE_URL='$DATABASE_PUBLIC_URL'; pnpm tsx scripts/issue-orders-key.ts 'Trestolt Bygg AS'"

import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";

const prisma = new PrismaClient();

// Mirror src/lib/api-key.ts token shape (atn_ prefix + 32 random bytes hex)
// and hashing (sha256 hex) without importing @/ alias under tsx.
function generateApiToken(): string {
  return "atn_" + randomBytes(32).toString("hex");
}
function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function main() {
  const orgRef = process.argv[2] ?? "Trestolt Bygg AS";
  const org = await prisma.organization.findFirst({ where: { name: orgRef } });
  if (!org) throw new Error(`Org not found: ${orgRef}`);

  const superadmin = await prisma.user.findFirst({
    where: { role: "SUPERADMIN" },
    orderBy: { createdAt: "asc" },
  });
  if (!superadmin) throw new Error("No SUPERADMIN user found");

  const token = generateApiToken();
  const created = await prisma.apiKey.create({
    data: {
      name: "SCENARIO-TEST orders:write (revoke after)",
      scopes: "catalog:read,orders:write",
      tokenHash: hashApiToken(token),
      createdBy: superadmin.id,
      organizationId: org.id,
    },
  });

  console.log("Test orders:write key issued (DB-direct, bypassed allowlist):");
  console.log("  keyId ", created.id);
  console.log("  org   ", org.name, org.id);
  console.log("  scopes", created.scopes);
  console.log("  TOKEN ", token);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
