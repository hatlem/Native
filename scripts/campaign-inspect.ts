/**
 * Read-only campaign helper: resolve the IDs needed to ingest a reply.
 * Usage: pnpm tsx scripts/campaign-inspect.ts "<publisher name fragment>" [titleFragment ...]
 * Prints the SUPERADMIN actor, matching publisher(s), their titles (id,
 * name, active, discontinued), recent ContactLogs, and known SalesContacts.
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const [pubFrag, ...titleFrags] = process.argv.slice(2);

  const admin = await prisma.user.findFirst({
    where: { role: "SUPERADMIN" },
    select: { id: true, email: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("SUPERADMIN:", admin);

  if (!pubFrag) {
    console.log("(no publisher fragment given)");
    return;
  }

  const publishers = await prisma.publisher.findMany({
    where: { name: { contains: pubFrag, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  console.log(`\nPublishers matching "${pubFrag}":`, publishers);

  const pubIds = publishers.map((p) => p.id);
  const titles = await prisma.title.findMany({
    where: {
      OR: [
        ...(pubIds.length ? [{ publisherId: { in: pubIds } }] : []),
        ...titleFrags.map((t) => ({
          name: { contains: t, mode: "insensitive" as const },
        })),
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      active: true,
      discontinuedAt: true,
      countryCode: true,
      digitalReach: true,
      monthlyReach: true,
      ownContentAllowed: true,
      contentPolicy: true,
      publisher: { select: { name: true } },
      products: { select: { id: true, type: true, name: true, basePrice: true, currency: true } },
      contactLogs: {
        select: { id: true, channel: true, direction: true, contactedAt: true, note: true },
        orderBy: { contactedAt: "desc" },
        take: 5,
      },
      salesContactLinks: {
        select: { salesContact: { select: { id: true, name: true, email: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  console.log(`\nTitles (${titles.length}):`);
  for (const t of titles) {
    console.log(`\n— ${t.name}  [${t.id}]  active=${t.active}${t.discontinuedAt ? " DISCONTINUED" : ""}`);
    console.log(`   publisher=${t.publisher?.name}  country=${t.countryCode}  digitalReach=${t.digitalReach ?? "-"} monthlyReach=${t.monthlyReach ?? "-"}`);
    console.log(`   ownContent=${t.ownContentAllowed} policy=${t.contentPolicy ?? "-"}`);
    if (t.products.length) console.log(`   products:`, t.products);
    if (t.salesContactLinks.length) console.log(`   salesContacts:`, t.salesContactLinks.map((l) => l.salesContact));
    if (t.contactLogs.length) console.log(`   contactLogs:`, t.contactLogs.map((c) => `${c.direction}/${c.channel} ${c.contactedAt.toISOString().slice(0,10)} "${(c.note ?? "").slice(0,60)}"`));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
