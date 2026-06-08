/** READ-ONLY. Cross-reference outreach_send_list.json against prod ContactLog
 * OUTBOUND to report which groups are still uncontacted. Prints next batch
 * candidates, NO first. Does not write anything. */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

type Group = { email: string; market: string; titles: string[]; wasEmail?: string };

async function main() {
  const list: Group[] = JSON.parse(readFileSync("outreach_send_list.json", "utf8"));

  const logs = await prisma.contactLog.findMany({
    where: { direction: "OUTBOUND" },
    select: { note: true, titleId: true },
  });

  const emailRe = /[\w.+-]+@[\w.-]+\.\w{2,}/g;
  const contactedEmails = new Set<string>();
  const contactedTitleIds = new Set<string>();
  for (const l of logs) {
    if (l.titleId) contactedTitleIds.add(l.titleId);
    if (l.note) for (const m of l.note.toLowerCase().match(emailRe) ?? []) contactedEmails.add(m);
  }

  // Any title we already have a relationship with: a PriceQuote, or an INBOUND
  // contact (a reply). Re-asking these is redundant/embarrassing — treat as engaged.
  const quotes = await prisma.priceQuote.findMany({ select: { product: { select: { titleId: true } } } });
  for (const q of quotes) if (q.product?.titleId) contactedTitleIds.add(q.product.titleId);
  const inbound = await prisma.contactLog.findMany({ where: { direction: "INBOUND" }, select: { titleId: true } });
  for (const l of inbound) if (l.titleId) contactedTitleIds.add(l.titleId);

  // Resolve each group's titleIds (by name+market) once.
  const byMarketUncontacted: Record<string, Group[]> = {};
  let contactedCount = 0;
  for (const g of list) {
    const emailHit = contactedEmails.has(g.email.toLowerCase()) ||
      (g.wasEmail ? contactedEmails.has(g.wasEmail.toLowerCase()) : false);
    let titleHit = false;
    if (!emailHit) {
      const titles = await prisma.title.findMany({
        where: { countryCode: g.market, name: { in: g.titles, mode: "insensitive" } },
        select: { id: true },
      });
      // contacted if ALL resolvable titles already have an OUTBOUND log (and there is at least one)
      titleHit = titles.length > 0 && titles.every((t) => contactedTitleIds.has(t.id));
    }
    if (emailHit || titleHit) { contactedCount++; continue; }
    (byMarketUncontacted[g.market] ??= []).push(g);
  }

  console.log(`Total groups: ${list.length} | contacted: ${contactedCount} | uncontacted: ${list.length - contactedCount}`);
  console.log("Uncontacted by market:");
  for (const [m, gs] of Object.entries(byMarketUncontacted).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${m}: ${gs.length} groups, ${gs.reduce((s, g) => s + g.titles.length, 0)} titles`);
  }

  const order = ["NO", "SE", "DK", "FI", "DE", "AT", "CH", "UK", "IE"];
  const next: Group[] = [];
  for (const m of order) for (const g of byMarketUncontacted[m] ?? []) next.push(g);

  // Pull catalog profile for the next NO candidates so each email can be tailored.
  const slice = next.filter((g) => g.market === "SE").slice(0, 30);
  console.log(`\n=== Next ${slice.length} SE candidates with catalog profile (for tailoring) ===`);
  for (const g of slice) {
    const t = await prisma.title.findFirst({
      where: { countryCode: g.market, name: { in: g.titles, mode: "insensitive" } },
      select: { name: true, description: true, keywords: true, websiteUrl: true, city: true, region: true },
    });
    console.log(`\n• ${g.email}  → ${g.titles.join(", ")}`);
    if (t) {
      console.log(`   name: ${t.name}`);
      if (t.city || t.region) console.log(`   place: ${[t.city, t.region].filter(Boolean).join(", ")}`);
      if (t.websiteUrl) console.log(`   url: ${t.websiteUrl}`);
      if (t.keywords?.length) console.log(`   keywords: ${t.keywords.join(", ")}`);
      if (t.description) console.log(`   desc: ${t.description}`);
    } else {
      console.log(`   (no catalog match)`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
