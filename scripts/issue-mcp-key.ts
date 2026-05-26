// One-off helper to issue an API key with MCP scopes.
//
// Usage: pnpm tsx scripts/issue-mcp-key.ts [name] [scopes]
//   defaults: name="MCP local", scopes="catalog:read,pricing:admin"
//
// The raw token is printed to STDOUT exactly once. Copy it now —
// only the SHA-256 hash is stored in DB.

import { prisma } from "../src/lib/prisma";
import { generateApiToken, hashApiToken, parseScopes } from "../src/lib/api-key";
import { recordAudit } from "../src/lib/audit";

async function main() {
  const name = process.argv[2] ?? "MCP local";
  const scopesArg = process.argv[3] ?? "catalog:read,pricing:admin";

  // Pick the first SUPERADMIN as the createdBy (FK requirement) and as
  // the actor for any MCP mutations that record themselves as "the user
  // who issued the key".
  const superadmin = await prisma.user.findFirst({
    where: { role: "SUPERADMIN" },
    orderBy: { createdAt: "asc" },
  });
  if (!superadmin) {
    console.error("No SUPERADMIN user found — run the seed first.");
    process.exit(1);
  }

  const scopeSet = parseScopes(scopesArg);
  if (scopeSet.size === 0) {
    console.error(`Invalid scopes: ${scopesArg}`);
    process.exit(1);
  }

  const token = generateApiToken();
  const tokenHash = hashApiToken(token);

  const created = await prisma.apiKey.create({
    data: {
      name,
      scopes: Array.from(scopeSet).join(","),
      tokenHash,
      createdBy: superadmin.id,
    },
  });

  await recordAudit(superadmin.id, "api_key.create", `ApiKey:${created.id}`, {
    name,
    scopes: Array.from(scopeSet),
    via: "scripts/issue-mcp-key.ts",
  });

  console.log("");
  console.log("API key issued:");
  console.log(`  name        ${created.name}`);
  console.log(`  id          ${created.id}`);
  console.log(`  scopes      ${created.scopes}`);
  console.log(`  createdBy   ${superadmin.email ?? superadmin.id}`);
  console.log("");
  console.log("Raw token (shown once — copy now):");
  console.log("");
  console.log(`  ${token}`);
  console.log("");
  console.log("Add to Claude Code:");
  console.log(
    `  claude mcp add native-local --transport http http://localhost:3000/api/mcp --header "X-API-Key: ${token}"`,
  );
  console.log("");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
