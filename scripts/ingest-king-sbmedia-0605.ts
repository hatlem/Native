/** King Magazine (SB-Media, Erik Bergström) native prices, 2026-06-05 13:12.
 * Annelie Söderstedt forwarded King-delen til Erik (kollega). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T13:12:00.000Z");
const KING = { title:"cmpmdiqag02f80hu05c4znaky", prod:"cmpn1ct5r00y10hvywbsu3qpk" };
async function main() {
  const log = await createContactLog({ titleId:KING.title, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-05: Erik Bergström (Annonsansvarig, SB-Media – King Magazine + Café, erik@sb-media.se, 0707-301262). Annelie Söderstedt videresendte King-delen til ham. NATIVE King Magazine: redaksjonen skriver artikkelen = 45 000 SEK (ord. 65 000); kunde leverer ferdig tekst = 30 000 SEK. Garanterer minst 5 000 artikellesninger i begge tilfeller. Kan skreddersy. Display (utenfor scope): 980x240/320x320, topscroll, midscroll. Mediakit (Café+King) vedlagt – Café-pris i mediakit (samme kontakt).",
    actorId:ACTOR });
  await logQuote({ productId:KING.prod, contactLogId:log.id, price:45000, currency:"SEK", priceUnit:"FLAT",
    includedText:"Native der redaksjonen skriver artikkelen. Ord. pris 65 000. Garantert min 5 000 artikellesninger. Eks. moms.", recordedById:ACTOR });
  await logQuote({ draftProductType:"NATIVE_ARTICLE", draftProductName:"Native – ferdig tekst (King Magazine)",
    draftProductDesc:"Native der kunde leverer ferdig tekst (kingmagazine.se).",
    contactLogId:log.id, price:30000, currency:"SEK", priceUnit:"FLAT",
    includedText:"Native med ferdig tekst fra kunde. Garantert min 5 000 artikellesninger. Eks. moms.", recordedById:ACTOR });
  await prisma.title.update({ where:{id:KING.title}, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
    verificationStatus:"LIVE", verificationSource:"SB-Media (Erik Bergström) konkret pris 2026-06-05; kingmagazine.se" } });
  console.log("King Magazine: 2 native-quotes (45 000 redaksjonell / 30 000 ferdig tekst).");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
