/** Ingest Lotta Fredriksson's (Hippson) concrete native price, 2026-06-05 10:48.
 * "Sponsrad Artikel ... 29 000 ex moms" (SEK) — package:
 *  - Artikeln på sajten
 *  - Boostad 10 dgr på FB
 *  - 1 v Insta Story med 3 inlägg
 *  - 1st Stand Alone utskick till 35 000 mottagare
 * She handles ONLY Hippson (Vi Med Häst needs its own contact). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T10:48:00.000Z");
const HIPPSON = "cmpmdiqai02ie0hu0ar0nr5kz";
const HIPPSON_NATIVE = "cmpn1ct5s01150hvyow142z8a";

async function main() {
  const inbound = await createContactLog({
    titleId: HIPPSON,
    channel: "EMAIL",
    direction: "INBOUND",
    note:
      "INBOUND 2026-06-05 10:48: Lotta Fredriksson (KAM, Hippson) sendte KONKRET pris. " +
      "Sponsrad Artikel = 29 000 SEK eks. moms. Inkluderer: artikkel på sajten + boostet 10 dager på Facebook + " +
      "1 uke Insta Story med 3 innlegg + 1 Stand Alone nyhetsbrev-utsendelse til 35 000 mottakere. " +
      "Materiell til annons@hippson.se. Mediekit: https://hippson.ocast.com/sv . Lager skarp offert når vi kommer tilbake med kunde. " +
      "Håndterer KUN Hippson (Vi Med Häst trenger egen kontakt).",
    actorId: ACTOR,
  });

  await logQuote({
    productId: HIPPSON_NATIVE,
    contactLogId: inbound.id,
    price: 29000,
    currency: "SEK",
    priceUnit: "FLAT",
    includedText:
      "Sponsrad Artikel (native): artikkel på hippson.se + boostet 10 dgr på FB + 1 uke Insta Story (3 innlegg) " +
      "+ 1 Stand Alone nyhetsbrev til 35 000 mottakere. Pris eks. moms.",
    recordedById: ACTOR,
  });

  await prisma.title.update({
    where: { id: HIPPSON },
    data: { offersNativeContent: true, pricingAsOf: NOW, lastVerifiedAt: NOW,
      verificationStatus: "LIVE", verificationSource: "Hippson (Lotta Fredriksson) konkret pris 2026-06-05; hippson.ocast.com/sv" },
  });

  console.log("Hippson: 1 PriceQuote (29 000 SEK eks moms, Sponsrad Artikel), offersNative=true, pricingAsOf set.");
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
