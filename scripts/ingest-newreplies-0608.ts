/** Today's (06-08) replies to the tailored lokalavis-batch: Østhavet (body prices),
 * Vestavind + Øy-Blikk (prices in PDF → noted as outstanding). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
async function findNO(name: string) {
  return prisma.title.findFirst({ where: { countryCode: "NO", name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true, outstandingInfo: true } });
}

async function main() {
  // Østhavet — full price list in body; native 2730/uke
  const ost = await findNO("Østhavet");
  if (ost) {
    const log = await createContactLog({ titleId: ost.id, channel: "EMAIL", direction: "INBOUND",
      note: "INBOUND 2026-06-08: Robin Røkke (Framhug media AS / Østhavet, rr@tvisyn.media, tlf 915 24 236) på vegne av post@osthavet.no. " +
        "Prisliste gjeldende 19.02.2026–01.02.2027, eks. mva. NATIVE-ARTIKKEL: 2730 kr/uke (8190 kr/mnd). " +
        "Nett display: Toppbanner 1680/uke (5040/mnd), Netboard 1365/uke (4095/mnd), Artikkelboard 1260/uke (3780/mnd), Modul1 karusell 840/uke (2520/mnd). " +
        "Papiravis: Helside 10395, Halvside 6720, Kvartside 4620. Fastavtale (lengre varighet) gir andre priser. Native vises på partneravisen ra24.no.",
      actorId: ACTOR });
    await logQuote({ draftProductType: "NATIVE_ARTICLE", draftProductName: "Native-artikkel (Østhavet)",
      draftProductDesc: "Native-artikkel på nett, vises også på partneravisen ra24.no.", contactLogId: log.id,
      price: 2730, currency: "NOK", priceUnit: "FLAT", validUntil: new Date("2027-02-01"),
      includedText: "Pris per uke (8190 kr/mnd), eks. mva. Fastavtale gir andre priser.", recordedById: ACTOR });
    await prisma.title.update({ where: { id: ost.id }, data: { offersNativeContent: true } });
    console.log("Østhavet: native-quote 2730/uke + full prisliste i INBOUND-logg + offersNative");
  } else console.log("! Østhavet not found");

  // Vestavind — small, native på forespørsel; general prices in 10MB PDF
  const ves = await findNO("Vestavind");
  if (ves) {
    await createContactLog({ titleId: ves.id, channel: "EMAIL", direction: "INBOUND",
      note: "INBOUND 2026-06-08: Susanne Lie Vallestad (Dagleg leiar/Marknadsansvarleg, Vestavind AS, mob 930 515 63). " +
        "Liten avis – ingen full native-prisliste, men tilpasser native-pris på forespørsel. Generelle priser nett+papir i vedlegg 'vestavind_modulkart og prisar 2026.pdf' (10 MB, ikke ekstrahert).",
      actorId: ACTOR });
    const oi = new Set([...(ves.outstandingInfo ?? []), "Native-pris på forespørsel; generelle nett/papir-priser i PDF (vestavind_modulkart og prisar 2026.pdf) – ikke ekstrahert"]);
    await prisma.title.update({ where: { id: ves.id }, data: { outstandingInfo: { set: [...oi] } } });
    console.log("Vestavind: INBOUND-logg + outstandingInfo (priser i PDF, native på forespørsel)");
  } else console.log("! Vestavind not found");

  // Øy-Blikk — prices in 2 PDFs
  const oy = await findNO("Øy-Blikk");
  if (oy) {
    await createContactLog({ titleId: oy.id, channel: "EMAIL", direction: "INBOUND",
      note: "INBOUND 2026-06-08: Stina Hormazabal (stina@oyblikk.no) sendte prislister i 2 vedlegg: 'Priser2026.pdf' + 'NettPriser2026.pdf' (ikke ekstrahert).",
      actorId: ACTOR });
    const oi = new Set([...(oy.outstandingInfo ?? []), "Priser i PDFer (Priser2026.pdf, NettPriser2026.pdf) – ikke ekstrahert"]);
    await prisma.title.update({ where: { id: oy.id }, data: { outstandingInfo: { set: [...oi] } } });
    console.log("Øy-Blikk: INBOUND-logg + outstandingInfo (priser i 2 PDFer)");
  } else console.log("! Øy-Blikk not found");

  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
