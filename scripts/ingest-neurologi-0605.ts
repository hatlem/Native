/** Neurologi i Sverige (Pharma Industry Sweden, Malin Tilja) — Mediakit NIS 2026.
 * Fix mangled name, log native prices + publication data. Native-only focus. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T10:58:00.000Z");
const NEU = "cmpmdiqai02jc0hu077ygi6h1";
const NEU_NATIVE = "cmpn1ct5s01230hvyate02mt1";

async function main() {
  await prisma.title.update({ where:{ id:NEU }, data:{
    name: "Neurologi i Sverige", slug: "neurologi-i-sverige-se",
    aliases: { set: ["NeurologiSverige", "Neurologi Sverige"] },
    offersNativeContent: true, pricingAsOf: NOW, lastVerifiedAt: NOW,
    verificationStatus: "LIVE", verificationSource: "Pharma Industry Sweden (Malin Tilja) Mediakit NIS 2026; neurologiisverige.se",
    description: "Etablert svensk fagmagasin for nevrologi siden 2011 (Pharma Industry Publishing). 4 utgaver/år.",
  }});

  const log = await createContactLog({
    titleId: NEU, channel: "EMAIL", direction: "INBOUND",
    note:
      "INBOUND 2026-06-05: Malin Tilja (Pharma Industry Sweden, malin.tilja@pharma-industry.se, +46 70 983 01 00). Mediakit NIS 2026 mottatt. " +
      "DIGITAL NATIVE: nativeannons i nyhetsbrev 21 000 SEK/uke; nativeannons på webbsida 21 000 SEK/uke. " +
      "Display (utenfor scope): toppbanner 980x240 (2 plasser) 28 000/mnd, sidobanner 25 000/mnd, stickybanner 31 500/mnd; nyhetsbrev-banner 17 000/15 000/13 000/11 000 per plass. Rabatt helår 10%/halvår 5%. " +
      "Utdanningspakke: webb+nyhetsbrev 28 000; +helside i tidning 36 000; 5-pack inkl. tidningsannons 145 000. Webinarinnspilling i studio (offert). " +
      "Magasin siden 2011, 4 nr/år; sendes til 716 klinikker/mottak, 1220 leger + 30 spesialsykepleiere; deles på kongresser. " +
      "Web neurologiisverige.se ~15 140 visninger/mnd; nyhetsbrev 1540 mottakere, 52% åpningsfrekvens, CTR banner 0,75%. Materiell: vendela.ekmark@pharma-industry.se.",
    actorId: ACTOR,
  });

  await logQuote({ productId: NEU_NATIVE, contactLogId: log.id, price: 21000, currency: "SEK", priceUnit: "FLAT",
    includedText: "Nativeannons på webbsida (neurologiisverige.se), pris per uke. Bilde + rubrik (max 60 tegn) + utdrag (max 400 tegn) + innlegg (max 6 000 tegn). Web ~15 140 visninger/mnd.", recordedById: ACTOR });
  await logQuote({ draftProductType:"NATIVE_ARTICLE", draftProductName:"Nativeannons i nyhetsbrev (Neurologi i Sverige)",
    draftProductDesc:"Native i ukentlig nyhetsbrev (fredager). Bilde liggende + rubrik (max 70 tegn) + sammendrag (max 600 tegn).",
    contactLogId: log.id, price: 21000, currency: "SEK", priceUnit: "FLAT",
    includedText:"Nativeannons i nyhetsbrev, pris per uke/utskick. Nyhetsbrev 1540 mottakere, 52% åpningsfrekvens.", recordedById: ACTOR });

  console.log("Neurologi i Sverige: navn fikset, 2 native-quotes (21 000 SEK/uke webb + nyhetsbrev), data + offersNative=true.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
