/** Ingest reply from Thomas Myhrvold (Annonseansvarlig, Vårt Land) 2026-06-04.
 * Facts given:
 *  - Vårt Land Junior finnes ikke ("KI som har rota her?") -> deaktiver.
 *  - Magasinet Strek: ingen digitale annonsemuligheter, kun print.
 *    Vi har duplikat "Strek" + "Magazinet Strek" (skrivefeil) -> slå sammen.
 *  - Vårt Land (vl.no): to reelle priser (eks. mva):
 *      * Advertorial-teaser på front, 100% visning 1 uke: kr 10 000 (veil. 52 500)
 *      * Native-helside i print-avisen: kr 10 000 (veil. 46 711)
 *  - Han vil at vi ringer ("ring meg i morra") -> flagges til Andreas.
 */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-04T22:30:00.000Z");

const VL_TITLE = "cmpmdiq9x01nm0hu0ha3e2z8u"; // Vårt Land
const VL_PRODUCT = "cmpn1ct3n006f0hvyzos3rhdi"; // Native article (existing)
const VL_JUNIOR = "cmpmdiqa8024q0hu0t9x2o0gw"; // Vårt Land Junior (finnes ikke)
const STREK = "cmpmdiqa7023a0hu0gneujj0o"; // "Strek" (duplikat)
const MAGAZINET_STREK = "cmpmdiqa401zj0hu0obhkyduz"; // "Magazinet Strek" -> survivor

async function main() {
  // 1) INBOUND-kontakt på Vårt Land med oppsummering + call-request
  const inbound = await createContactLog({
    titleId: VL_TITLE,
    channel: "EMAIL",
    direction: "INBOUND",
    note:
      "INBOUND 2026-06-04: Thomas Myhrvold (Annonseansvarlig, Vårt Land, thomasm@vl.no / +47 408 62 900) svarte. " +
      "Vårt Land (vl.no): advertorial-teaser på front, 100% visning i en uke = kr 10 000 eks. mva (veil. 52 500). " +
      "Ev. native-helside i print-avisen = kr 10 000 eks. mva (veil. 46 711). " +
      "Magasinet Strek: ingen digitale annonsemuligheter, kun print. 'Vårt Land Junior' finnes ikke. " +
      "Ber om at vi RINGER ham i morgen for å se på muligheter (flagget til Andreas).",
    actorId: ACTOR,
  });

  // 2) To PriceQuotes på Vårt Land
  await logQuote({
    productId: VL_PRODUCT,
    contactLogId: inbound.id,
    price: 10000,
    currency: "NOK",
    priceUnit: "FLAT",
    includedText: "Native-helside i print-avisen. Pris eks. mva. Veil. pris kr 46 711 eks. mva.",
    recordedById: ACTOR,
  });
  await logQuote({
    draftProductType: "ADVERTORIAL",
    draftProductName: "Advertorial-teaser på front (vl.no)",
    draftProductDesc: "Digital advertorial-teaser på vl.no-fronten, 100% visning i en uke.",
    contactLogId: inbound.id,
    price: 10000,
    currency: "NOK",
    priceUnit: "FLAT",
    includedText: "100% visning i en uke. Pris eks. mva. Veil. pris kr 52 500 eks. mva.",
    recordedById: ACTOR,
  });

  // 3) Vårt Land: bekreft at de tilbyr annonsørinnhold + datostempel
  await prisma.title.update({
    where: { id: VL_TITLE },
    data: { offersNativeContent: true, pricingAsOf: NOW },
  });

  // 4) Deaktiver Vårt Land Junior (finnes ikke)
  await prisma.title.update({
    where: { id: VL_JUNIOR },
    data: {
      discontinuedAt: NOW,
      discontinuedNote:
        "Avkreftet av Vårt Land (Thomas Myhrvold) 2026-06-04: tittelen finnes ikke – feilregistrert.",
    },
  });

  // 5) Slå sammen Strek-duplikat: behold "Magazinet Strek" som survivor,
  //    rett navn -> "Magasinet Strek", legg til alias, marker print-only;
  //    deaktiver "Strek" som duplikat.
  await prisma.title.update({
    where: { id: MAGAZINET_STREK },
    data: {
      name: "Magasinet Strek",
      aliases: { set: ["Strek", "Magazinet Strek"] },
      offersNativeContent: false,
      pricingAsOf: NOW,
      outstandingInfo: { set: ["Kun print, ingen digitale annonsemuligheter (Vårt Land 2026-06-04) – avklar evt. print-advertorial"] },
    },
  });
  await createContactLog({
    titleId: MAGAZINET_STREK,
    channel: "EMAIL",
    direction: "INBOUND",
    note: "INBOUND 2026-06-04: Vårt Land (Thomas Myhrvold) bekrefter Magasinet Strek har ingen digitale annonsemuligheter, kun print.",
    actorId: ACTOR,
  });
  await prisma.title.update({
    where: { id: STREK },
    data: {
      discontinuedAt: NOW,
      discontinuedNote: "Duplikat av Magasinet Strek (magazinet-strek-no). Slått sammen 2026-06-04.",
    },
  });

  console.log("Vårt Land: 2 quotes logget, offersNative=true, pricingAsOf satt.");
  console.log("Vårt Land Junior: deaktivert (finnes ikke).");
  console.log("Strek-duplikat: 'Magazinet Strek' -> 'Magasinet Strek' (print-only), 'Strek' deaktivert som duplikat.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
