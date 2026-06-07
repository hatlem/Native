/** Correct/augment Henrik Salén (Marina Media Sverige) rate-card ingest, 2026-06-05.
 * Earlier 09:32 log missed the På Kryss NEWSLETTER NATIVE price (8 730 SEK/utskick)
 * and mis-attributed Båtliv's print numbers to both. Native-only focus:
 *  - På Kryss: Native i nyhetsbrev = 8 730 SEK/utskick (nyhetsbrev ~22 000 mott., 50% öppning).
 *  - Båtliv: 2026-kortet = print + webb-display + bilagor; INGEN native-linje funnet. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T08:28:00.000Z");
const PAKRYSS = "cmpmdiqaf02e50hu0ndf73u5y";
const PAKRYSS_NATIVE = "cmpn1ct5e00wy0hvys4k51b4w";
const BATLIV = "cmpmdiqaf02e40hu0to6e21bk";

async function main() {
  // --- På Kryss: newsletter native ---
  const log = await createContactLog({
    titleId: PAKRYSS, channel: "EMAIL", direction: "INBOUND",
    note:
      "INBOUND 2026-06-05 (rate card, korrigert): Henrik Salén (Marina Media Sverige, henrik@batmedia.se). " +
      "NATIVE i nyhetsbrev = 8 730 SEK per utskick. Nyhetsbrev (Svenska Kryssarklubbens register) ~22 000 adresser, ~50% öppningsgrad, sendes søndager annenhver uke. " +
      "'För natives, kontakta din säljare.' Banner i nyhetsbrev: placering 1 8 730, placering 2 6 730, placering 3 5 730 kr/utskick (display). " +
      "Print (display, utenfor native-scope): Helsida 20 000, Uppslag 30 000, 2:a omslag 28 500, 3:e omslag 22 500, 4:e omslag 25 000, halvsida 12 500, kvartssida 7 500, åttondel 4 000, sextondel 2 500. " +
      "Digital tidning (På Kryss+): helsida 20 000, halvsida 12 500, kvartssida 7 500, åttondel 4 000. " +
      "Magasin: Svenska Kryssarklubben, 42 000 medlemmar, 5 nr/år (print+digital), opplag ~20 000.",
    actorId: ACTOR,
  });
  await logQuote({
    productId: PAKRYSS_NATIVE, contactLogId: log.id, price: 8730, currency: "SEK", priceUnit: "FLAT",
    includedText: "Native i nyhetsbrev (Svenska Kryssarklubben), pris per utskick. Nyhetsbrev ~22 000 mottakere, ~50% åpningsrate, sendes annenhver søndag. Redaksjonell native i nyhetsbrevet ('för natives, kontakta din säljare').",
    recordedById: ACTOR,
  });
  await prisma.title.update({ where:{ id:PAKRYSS }, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
    verificationStatus:"LIVE", verificationSource:"Marina Media (Henrik Salén) rate card 2026 – nyhetsbrev native 8 730 SEK/utskick" } });

  // --- Båtliv: no native line in card; display only ---
  const cur = await prisma.title.findUnique({ where:{ id:BATLIV }, select:{ outstandingInfo:true } });
  await createContactLog({
    titleId: BATLIV, channel: "EMAIL", direction: "INBOUND",
    note:
      "INBOUND 2026-06-05 (rate card, presisering): Henrik Salén (Marina Media). Båtliv 2026-kort = PRINT (Uppslag 64 900, 1/1 37 100, 1/32 2 000 m.fl.) " +
      "+ WEBB-DISPLAY på batliv.se (Toppbanner/Mittbanner 980x240: 19 400 kr/mån feb–juni / 11 200 kr/mån juli–jan; Större sidobanner 140x250: 7 500/4 500 kr/mån) + lokale bilagor. " +
      "INGEN native-/advertorial-linje i Båtliv-kortet (i motsetning til På Kryss som har nyhetsbrev-native). Henrik tilbyr å sette sammen komplett print–webb-pakke. Native-pris for Båtliv må etterspørres.",
    actorId: ACTOR,
  });
  await prisma.title.update({ where:{ id:BATLIV }, data:{ lastVerifiedAt:NOW, verificationStatus:"LIVE",
    verificationSource:"Marina Media (Henrik Salén) rate card 2026 – display/print (native ikke i kort)",
    outstandingInfo:{ set:[...new Set([...(cur?.outstandingInfo??[]), "Native-/advertorial-pris ikke i 2026-kortet (kun display print+webb+bilagor) – etterspurt hos Henrik Salén/Marina Media"])] } } });

  console.log("På Kryss: native nyhetsbrev 8 730 SEK/utskick logget (quote+log), offersNative=true. Båtliv: display-kort presisert, native etterspurt (outstandingInfo).");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
