/** Ingest 2026-06-05 campaign replies (Tun Media, TU Media, Hippson).
 * No prices to quote yet — these are availability/price-source + confirmations.
 * Reply policy: none needed (no questions; TU+Hippson await our client brief). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T10:30:00.000Z");
const log = (titleId: string, note: string) =>
  createContactLog({ titleId, channel: "EMAIL", direction: "INBOUND", note, actorId: ACTOR });

const T = {
  bondebladet: "cmpmdiqa201vt0hu0hcjfu9np",
  norskLandbruk: "cmpmdiqa602150hu02xbjuhbf",
  nationen: "cmpmdiq9v01ku0hu06d97zqfy",
  tuNo: "cmpmdiqaa02740hu0wmaem2bd",
  digiNo: "cmpmdiq9y01qa0hu0r405b45z",
  hippson: "cmpmdiqai02ie0hu0ar0nr5kz",
};

async function main() {
  // --- Tun Media (Christian Lind, christian.lind@tunmedia.no) ---
  const tunNote =
    "INBOUND 2026-06-05: Christian Lind (Salgsdir., Tun Media AS). Tun Media er Amedia-eid; Amedias display-prisliste gjelder også for dem: https://www.amediaannonse.no/annonsering/annonseformater-display . Min Energi nedlagt for ~3 år siden. Bondebladet, Norsk Landbruk og Traktor: UTSOLGT digitalt, kun ledig i print. Nationen: ledig digitalt.";
  await log(T.bondebladet, tunNote);
  await log(T.norskLandbruk, tunNote);
  await log(T.nationen, tunNote);

  // Bondebladet + Norsk Landbruk: digital sold out (we sell digital native) -> flag
  for (const id of [T.bondebladet, T.norskLandbruk]) {
    const cur = await prisma.title.findUnique({ where: { id }, select: { outstandingInfo: true } });
    await prisma.title.update({
      where: { id },
      data: {
        outstandingInfo: { set: [...new Set([...(cur?.outstandingInfo ?? []), "Digitalt annonsørinnhold UTSOLGT (Tun Media 2026-06-05) – kun print ledig"])] },
        pricingAsOf: NOW, lastVerifiedAt: NOW,
        verificationStatus: "LIVE", verificationSource: "Tun Media (Christian Lind) 2026-06-05; amediaannonse.no rate card",
      },
    });
  }
  // Nationen: digital available, Amedia price ref
  await prisma.title.update({
    where: { id: T.nationen },
    data: { pricingAsOf: NOW, lastVerifiedAt: NOW, verificationStatus: "LIVE",
      verificationSource: "Tun Media (Christian Lind) 2026-06-05; amediaannonse.no rate card" },
  });

  // --- TU Media (Jan-Øyvind Kristiansen, jok@tumedia.no — TU.no + Digi.no) ---
  const tuNote =
    "INBOUND 2026-06-05: Jan-Øyvind Kristiansen (Strategisk KAM, TU Media). Premium native + Brand Story mest aktuelt. Avventer vår konkrete brief (kunde/periode/mål) før avtaler/møte. Ingen priser ennå.";
  await log(T.tuNo, tuNote);
  await log(T.digiNo, tuNote);
  // TU.no confirmed real by the publisher -> LIVE
  await prisma.title.update({
    where: { id: T.tuNo },
    data: { verificationStatus: "LIVE", verificationSource: "TU Media (Jan-Øyvind Kristiansen) reply 2026-06-05; tumedia.no", lastVerifiedAt: NOW },
  });

  // --- Hippson (Lotta Fredriksson, lotta@hippson.se) ---
  await log(T.hippson,
    "INBOUND 2026-06-05: Lotta Fredriksson (KAM, Hippson). Håndterer KUN Hippson (ikke Vi Med Häst – trenger egen kontakt). Priser: https://hippson.ocast.com/sv (Ocast mediekit, PDF mottatt). Annonsemateriell til annons@hippson.se. Lager offert når vi kommer tilbake med kunde. Hesten (NO): https://hest.ocast.com/nb/ .");
  await prisma.title.update({
    where: { id: T.hippson },
    data: { pricingAsOf: NOW, lastVerifiedAt: NOW, verificationStatus: "LIVE",
      verificationSource: "Hippson (Lotta Fredriksson) 2026-06-05; hippson.ocast.com/sv" },
  });

  console.log("Ingested 3 replies: Tun Media (3 titles), TU Media (2), Hippson (1). No PriceQuotes (price sources noted, awaiting concrete numbers).");
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
