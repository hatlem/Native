// Issue a pricing-admin API key for the MCP server. This scope unlocks
// both the read and mutation pricing tools (titles needing checks, sales
// contacts, price requests, quotes, and the contact log) over
// /api/mcp.
//
// Usage: pnpm issue-pricing-admin-key [name]
//   (or:  pnpm tsx scripts/issue-pricing-admin-key.ts [name])
//
// The prod DB is internal-only, so run this in the prod environment, e.g.
//   railway run pnpm issue-pricing-admin-key "Claude MCP"
//
// The raw token is printed to STDOUT exactly once. Copy it now — only the
// SHA-256 hash is stored.

import { prisma } from "../src/lib/prisma";
import { generateApiToken, hashApiToken } from "../src/lib/api-key";
import { recordAudit } from "../src/lib/audit";

async function main() {
  const name = process.argv[2] ?? "Claude MCP (pricing:admin)";

  const superadmin = await prisma.user.findFirst({
    where: { role: "SUPERADMIN" },
    orderBy: { createdAt: "asc" },
  });
  if (!superadmin) {
    console.error("No SUPERADMIN user found — run the seed first.");
    process.exit(1);
  }

  const token = generateApiToken();
  const created = await prisma.apiKey.create({
    data: {
      name,
      scopes: "pricing:admin",
      tokenHash: hashApiToken(token),
      createdBy: superadmin.id,
    },
  });

  await recordAudit(superadmin.id, "api_key.create", `ApiKey:${created.id}`, {
    name,
    scopes: ["pricing:admin"],
    via: "scripts/issue-pricing-admin-key.ts",
  });

  console.log("");
  console.log("Pricing-admin MCP key issued:");
  console.log(`  name    ${created.name}`);
  console.log(`  scopes  pricing:admin`);
  console.log(`  id      ${created.id}`);
  console.log("");
  console.log("Raw token (shown once — copy now):");
  console.log(`  ${token}`);
  console.log("");
  console.log("Register with Claude Code:");
  console.log(
    `  claude mcp add native --transport http https://nativespin.com/api/mcp --header "X-API-Key: ${token}"`,
  );
  console.log("");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
