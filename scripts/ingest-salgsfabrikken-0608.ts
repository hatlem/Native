/** Vidar Hovind (Salgsfabrikken) reply 06-08 re Bobilverden.no + Politiforum.
 * Body-level data (prices are in attached medieplan PDFs, not yet extracted). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";

async function findNO(names: string[]) {
  return prisma.title.findFirst({ where: { countryCode: "NO", name: { in: names, mode: "insensitive" } }, select: { id: true, name: true, outstandingInfo: true } });
}

async function main() {
  // Bobilverden.no — native available (newsletter content article); prices in PDF
  const bob = await findNO(["Bobilverden.no", "Bobilverden"]);
  if (bob) {
    await createContactLog({ titleId: bob.id, channel: "EMAIL", direction: "INBOUND",
      note: "INBOUND 2026-06-08: Vidar Hovind (Medierådgiver, Salgsfabrikken, vidar@salgsfabrikken.no, tlf 913 33 035). " +
        "Bobilverden.no TILBYR native: contentartikkel i nyhetsbrev (bilde 610x610px + tekst/lenker inntil ~700 tegn). " +
        "Web: bannerannonsering. Priser i vedlegg 'Bobilverden.no medieplan 2026.pdf' (ikke ekstrahert). Kan gi tilbud på flere perioder.",
      actorId: ACTOR });
    const oi = new Set([...(bob.outstandingInfo ?? []), "Native-/annonsepriser i medieplan-PDF (Bobilverden.no medieplan 2026.pdf) – ikke ekstrahert"]);
    await prisma.title.update({ where: { id: bob.id }, data: { offersNativeContent: true, outstandingInfo: { set: [...oi] }, adSales: "Salgsfabrikken (Vidar Hovind)" } });
    console.log(`Bobilverden.no [${bob.name}]: native-format + INBOUND-logg + outstandingInfo (priser i PDF)`);
  } else console.log("! Bobilverden.no not found");

  // Politiforum / Norsk Politi — does NOT offer native
  const pol = await findNO(["Norsk Politi", "Politiforum"]);
  if (pol) {
    await createContactLog({ titleId: pol.id, channel: "EMAIL", direction: "INBOUND",
      note: "INBOUND 2026-06-08: Vidar Hovind (Salgsfabrikken). Politiforum TILBYR IKKE native/annonsørinnhold. " +
        "Kun bannerannonsering på web (rollover/parallax er største format). Medieplan: 'Politiforum medieplan 2026_.pdf'.",
      actorId: ACTOR });
    await prisma.title.update({ where: { id: pol.id }, data: { offersNativeContent: false, contentPolicy: "Tilbyr ikke native/annonsørinnhold – kun bannerannonsering på web (rollover/parallax). Salgsfabrikken/Vidar Hovind 2026-06-08.", adSales: "Salgsfabrikken (Vidar Hovind)" } });
    console.log(`Norsk Politi/Politiforum [${pol.name}]: offersNative=false + INBOUND-logg + contentPolicy`);
  } else console.log("! Norsk Politi/Politiforum not found");

  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
