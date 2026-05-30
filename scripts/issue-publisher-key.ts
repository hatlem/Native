// Issue a publisher ingestion API key (catalog:write, bound to one
// publisher) for the programmatic inventory API.
//
// Usage: pnpm tsx scripts/issue-publisher-key.ts <publisherId|publisherName> [name]
//
// The raw token is printed to STDOUT exactly once. Copy it now — only the
// SHA-256 hash is stored. The key may ONLY read/write the named
// publisher's inventory.

import { prisma } from "../src/lib/prisma";
import { generateApiToken, hashApiToken } from "../src/lib/api-key";
import { recordAudit } from "../src/lib/audit";

async function main() {
  const ref = process.argv[2];
  if (!ref) {
    console.error("Usage: pnpm tsx scripts/issue-publisher-key.ts <publisherId|publisherName> [name]");
    process.exit(1);
  }

  const publisher =
    (await prisma.publisher.findUnique({ where: { id: ref } })) ??
    (await prisma.publisher.findFirst({ where: { name: ref } }));
  if (!publisher) {
    console.error(`No publisher found for "${ref}" (by id or name).`);
    process.exit(1);
  }

  const name = process.argv[3] ?? `${publisher.name} ingestion`;

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
      scopes: "catalog:write",
      tokenHash: hashApiToken(token),
      createdBy: superadmin.id,
      publisherId: publisher.id,
    },
  });

  await recordAudit(superadmin.id, "api_key.create", `ApiKey:${created.id}`, {
    name,
    scopes: ["catalog:write"],
    publisherId: publisher.id,
    via: "scripts/issue-publisher-key.ts",
  });

  console.log("");
  console.log("Publisher ingestion key issued:");
  console.log(`  name        ${created.name}`);
  console.log(`  id          ${created.id}`);
  console.log(`  publisher   ${publisher.name} (${publisher.id})`);
  console.log(`  scopes      ${created.scopes}`);
  console.log("");
  console.log("Raw token (shown once — copy now):");
  console.log(`  ${token}`);
  console.log("");
  console.log("Use it:");
  console.log(
    `  curl -X PUT https://nativespin.com/api/v1/publisher/products \\\n    -H "Authorization: Bearer ${token}" \\\n    -H "Content-Type: application/json" \\\n    -d @inventory.json`,
  );
  console.log("");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
