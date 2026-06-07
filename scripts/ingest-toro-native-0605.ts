/** Tor Olav Borgen (Tun Media) native price after budget framing, 2026-06-05 12:52.
 * Fagpresse digital native SOV-pakke: Bondebladet.no + Norsklandbruk.no + Traktor.no
 * selges samlet. 6 500 kr/uke (SOV fra 10%) + dekningstillegg 4 500 kr (engangs, oppsett).
 * Ledig uke 30/31/33/34/35, resten utsolgt. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T12:52:00.000Z");
const T = [
  { title:"cmpmdiqa201vt0hu0hcjfu9np", prod:"cmpn1ct4400em0hvyjt8d93gd", name:"Bondebladet" },
  { title:"cmpmdiqa602150hu02xbjuhbf", prod:"cmpn1ct4i00jz0hvyek8773mu", name:"Norsk Landbruk" },
];
const NOTE = "INBOUND 2026-06-05 12:52: Tor Olav Borgen (Tun Media KAM) – NATIVE-pris etter budsjett-ramme. Fagpresse digital native SELGES SAMLET som én pakke: Bondebladet.no + Norsklandbruk.no + Traktor.no. SOV-modell (garantert andel av visninger, starter 10%, skalerbar). PRIS 6 500 kr/uke + dekningstillegg 4 500 kr (engangs, for å opprette native). Ledig uke 30, 31, 33, 34, 35 – resten av året utsolgt. (NB: Traktor.no ikke i katalog – del av pakken.)";
async function main() {
  for (const t of T) {
    const log = await createContactLog({ titleId:t.title, channel:"EMAIL", direction:"INBOUND", note:NOTE, actorId:ACTOR });
    await logQuote({ productId:t.prod, contactLogId:log.id, price:6500, currency:"NOK", priceUnit:"FLAT",
      includedText:"Digital native, fagpresse SOV-pakke (Bondebladet.no + Norsklandbruk.no + Traktor.no samlet), pris PER UKE (SOV fra 10%). + dekningstillegg 4 500 kr engangs for å opprette native. Ledig uke 30/31/33/34/35. Eks. mva.",
      recordedById:ACTOR });
    await prisma.title.update({ where:{id:t.title}, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
      verificationStatus:"LIVE", verificationSource:"Tun Media (Tor Olav Borgen) native-pris 2026-06-05" } });
  }
  console.log("Toro/Tun Media native: 6 500/uke + 4 500 oppsett logget på Bondebladet + Norsk Landbruk (Traktor.no notert som del av pakken).");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
