/** Resolve the previously-flagged data problems (verified via web):
 * 1. Dagens Perspektiv: "Ukeavisen Ledelse" is the former name (rebranded
 *    2019) → make canonical "Dagens Perspektiv"; merge duplicate "Personal
 *    og ledelse" (same site) into it. Medier og Ledelse offers annonsørinnhold.
 * 2. "Velferd" under Pensjonistforbundet is a mis-mapped duplicate of the
 *    defunct velferd.no (Pensjonistforbundet's mag is "Pensjonisten") → deactivate.
 * 3. Hest og Høver + Norsk Ridesport: no verifiable publisher/site, disowned
 *    by NRyF → deactivate as unverified. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { recordAudit } from "@/lib/audit";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const DP = "cmpmdiqaa02720hu0uolx5kip";        // Ukeavisen Ledelse → Dagens Perspektiv (canonical)
const DP_PUB = "cmpmdiq5700jq0hu0a50pq084";    // Medier og Ledelse
const PERSONAL = "cmpmdiqa702260hu0iizsi5lr";  // Personal og ledelse (duplicate)
const VELFERD_DUP = "cmpmdiqa8024k0hu0j8xnfhq4"; // Velferd (Pensjonistforbundet, mis-mapped)
const HEST = "cmpmdiq9z01r10hu06nxadqsw";      // Hest og Høver
const RIDESPORT = "cmpmdiqaa027d0hu0bhl3y5cy"; // Norsk Ridesport

async function main() {
  // 1) Make Ukeavisen Ledelse the canonical Dagens Perspektiv.
  await prisma.title.update({ where: { id: DP }, data: {
    name: "Dagens Perspektiv",
    slug: (await prisma.title.findFirst({ where: { slug: "dagens-perspektiv" } })) ? "dagens-perspektiv-ml" : "dagens-perspektiv",
    aliases: ["Ukeavisen Ledelse", "Personal og ledelse"],
    offersNativeContent: true,
    contentPolicy: "Ikke annonsørinnhold om casino/gambling.",
    outstandingInfo: ["prisliste annonsørinnhold (kommer når vi velger publikasjoner)"],
    keywords: ["ledelse", "arbeidsliv", "samfunnsstyring", "HR", "B2B", "native"],
    description: "Dagens Perspektiv (tidl. Ukeavisen Ledelse, rebrandet 2019). Medier og Ledelse AS. Dekker ledelse, arbeidsliv og samfunnsstyring; nyhetsbrev ~17 000 abonnenter, 6 printutgaver/år. Tilbyr annonsørinnhold.",
    lastVerifiedAt: new Date(),
  } });
  console.log("Renamed Ukeavisen Ledelse → Dagens Perspektiv (canonical)");

  // Merge duplicate "Personal og ledelse" → canonical.
  const dpProduct = await prisma.product.findFirst({ where: { titleId: DP } });
  await prisma.$transaction(async (tx) => {
    await tx.contactLog.updateMany({ where: { titleId: PERSONAL }, data: { titleId: DP } });
    await tx.priceRequest.updateMany({ where: { titleId: PERSONAL }, data: { titleId: DP } });
    await tx.rateCardDocument.updateMany({ where: { titleId: PERSONAL }, data: { titleId: DP } });
    const persProducts = await tx.product.findMany({ where: { titleId: PERSONAL } });
    for (const p of persProducts) {
      if (dpProduct) await tx.priceQuote.updateMany({ where: { productId: p.id }, data: { productId: dpProduct.id } });
      await tx.product.delete({ where: { id: p.id } });
    }
    await tx.title.update({ where: { id: PERSONAL }, data: { active: false, discontinuedAt: new Date(), discontinuedNote: `Duplikat av «Dagens Perspektiv» [${DP}] — samme nettsted (dagensperspektiv.no), Medier og Ledelse. Slått sammen 2026-06-04.` } });
  });
  await recordAudit(ACTOR, "title.merge", `Title:${PERSONAL}`, { mergedInto: DP });
  console.log("Merged Personal og ledelse → Dagens Perspektiv");

  // Link Bjarte as sales contact on Dagens Perspektiv + INBOUND note.
  const sc = await prisma.salesContact.upsert({
    where: { publisherId_email: { publisherId: DP_PUB, email: "bjarte@dagensperspektiv.no" } },
    update: { name: "Bjarte Lerø", phone: "+47 984 14 150", role: "Dagens Perspektiv / Medier og Ledelse" },
    create: { publisherId: DP_PUB, name: "Bjarte Lerø", email: "bjarte@dagensperspektiv.no", phone: "+47 984 14 150", role: "Dagens Perspektiv / Medier og Ledelse" },
  });
  const link = await prisma.salesContactTitle.findFirst({ where: { titleId: DP } });
  if (!link) await prisma.salesContactTitle.create({ data: { salesContactId: sc.id, titleId: DP, isPrimary: true } });
  await createContactLog({ titleId: DP, salesContactId: sc.id, channel: "EMAIL", direction: "INBOUND", contactedAt: new Date("2026-06-04T10:53:00Z"), note: "Del av Bjarte Lerø-tråden (se Samtiden): tilbyr annonsørinnhold på dagensperspektiv.no. Ba om tilbud på hele Medier og Ledelse-porteføljen. Policy: ikke casino/gambling.", actorId: ACTOR });
  console.log(`Linked Bjarte + INBOUND on Dagens Perspektiv`);

  // 2) Deactivate mis-mapped Velferd duplicate.
  await prisma.title.update({ where: { id: VELFERD_DUP }, data: { active: false, discontinuedAt: new Date(), discontinuedNote: "Feilmappet duplikat: velferd.no er nedlagt (Medier og Ledelse-blad, → dagensperspektiv.no). Pensjonistforbundets blad heter «Pensjonisten», ikke Velferd. Deaktivert 2026-06-04." } });
  console.log("Deactivated mis-mapped Velferd (Pensjonistforbundet)");

  // 3) Deactivate unverifiable horse titles.
  await prisma.title.update({ where: { id: HEST }, data: { active: false, discontinuedAt: new Date(), discontinuedNote: "Uverifisert: ingen bekreftet nettside/utgiver, ingen aktiv kontakt. Var feilmappet til rytter.no (NRyF, som ikke vedkjenner seg den). Deaktivert i påvente av verifisering 2026-06-04." } });
  await prisma.title.update({ where: { id: RIDESPORT }, data: { active: false, discontinuedAt: new Date(), discontinuedNote: "Uverifisert: ingen bekreftet nettside/utgiver. Per NRyF (Pia Henriksen) ikke deres publikasjon; var feilmappet til rytter.no. Deaktivert i påvente av verifisering 2026-06-04." } });
  console.log("Deactivated Hest og Høver + Norsk Ridesport (unverified)");

  console.log("\nDone.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
