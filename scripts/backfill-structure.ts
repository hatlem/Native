/** Restructure: move recurring data out of commercialExtra into the new
 * structured fields, set offersNativeContent (the core catalog dimension),
 * and log Tannlegetidende's remaining rate-card formats as PriceQuotes
 * instead of a JSON price grid. commercialExtra is trimmed to only the
 * genuinely unstructurable bits (deadlines, opplag breakdown, format specs). */
import { prisma } from "@/lib/prisma";
import { logQuote } from "@/lib/pricing/quotes";
import type { ProductType, PriceUnit } from "@prisma/client";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";

const T = {
  finansavisen: "cmpmdiq9t01ig0hu0f5lj7zs5",
  kapital: "cmpmdiq9z01rl0hu0z78xy6wr",
  tidende: "cmpmdiqa201we0hu07ls2kktr",
  tu: "cmpmdiqaa02740hu0wmaem2bd",
  digi: "cmpmdiq9y01qa0hu0r405b45z",
  rytter: "cmpzi9boa00030harxck57b3d",
  nryf: "cmpzi9bqr00050harvgro7rk5",
};
// Tannlege attribution (from earlier ingest run).
const TIDENDE_LOG = "cmpzd0szr00030hd4bfrqpgfr";
const TIDENDE_DOC = "cmpzd0tgw00090hd4er6x3si5";

async function main() {
  // 1) offersNativeContent — the core dimension.
  await prisma.title.updateMany({ where: { id: { in: [T.finansavisen, T.kapital, T.tidende, T.tu, T.digi] } }, data: { offersNativeContent: true } });
  await prisma.title.updateMany({ where: { id: { in: [T.rytter, T.nryf] } }, data: { offersNativeContent: false } });
  console.log("Set offersNativeContent (5 true, 2 false)");

  // 2) rytter.no: FB/IG → structured fields; trim commercialExtra.
  await prisma.title.update({ where: { id: T.rytter }, data: { facebookFollowers: 23000, instagramFollowers: 18000, commercialExtra: { source: "email:pia@rytter.no (2026-06-04)" } } });
  await prisma.title.update({ where: { id: T.nryf }, data: { commercialExtra: { source: "email:pia@rytter.no (2026-06-04)" } } });
  console.log("rytter.no FB/IG → fields; commercialExtra trimmed");

  // 3) Tannlegetidende: agency commission → field; log remaining formats as
  //    quotes; trim commercialExtra to unstructurable detail only.
  await prisma.title.update({ where: { id: T.tidende }, data: { agencyCommissionPct: 3.5 } });
  const tq = (name: string, price: number, type: ProductType, inc: string) =>
    logQuote({ draftProductType: type, draftProductName: name, draftProductDesc: inc, price, priceUnit: "FLAT" as PriceUnit, currency: "NOK", includedText: inc, contactLogId: TIDENDE_LOG, rateCardDocumentId: TIDENDE_DOC, recordedById: ACTOR });
  const printSizes: [string, number][] = [["2/3 side", 18100], ["1/2 side", 13900], ["1/3 side", 12350], ["1/4 side", 10600], ["1/6 side", 7800], ["1/8 side", 6600]];
  for (const [s, p] of printSizes) await tq(`Print ${s}`, p, "ADVERTORIAL", `Print ${s}, eks. mva.`);
  const special: [string, number][] = [["2. omslagsside", 23400], ["Ved Leder", 23400], ["Ved Presidenten har ordet", 23400], ["3. omslagsside", 22400], ["Baksiden", 24400], ["1/8 stripe ved «Siste nytt først»", 7700]];
  for (const [s, p] of special) await tq(`Spesialplassering: ${s}`, p, "ADVERTORIAL", `Spesialplassering print, eks. mva.`);
  const web: [string, number][] = [["Banner alle sider (pr. mnd)", 8000], ["Banner forside (pr. mnd)", 7000], ["Popup-banner (pr. mnd)", 9000]];
  for (const [s, p] of web) await tq(`Nettannonse: ${s}`, p, "NATIVE_DISPLAY", `Web, pris per måned, eks. mva.`);
  const rubrikk: [string, number][] = [["1/16", 2000], ["1/8", 3700], ["1/4", 7100], ["1/2", 13600]];
  for (const [s, p] of rubrikk) await tq(`Rubrikkannonse ${s} (web+print)`, p, "ADVERTORIAL", `Rubrikk, samme pris web/print, eks. mva.`);
  await tq("Spesialistannonse (kollegiale henvisninger)", 4800, "ADVERTORIAL", "4 innrykk i Tidende + fast på nettsiden. Eks. mva.");
  await prisma.title.update({ where: { id: T.tidende }, data: { commercialExtra: {
    source: "email:eirik.andreassen@tannlegeforeningen.no (2026-06-04)",
    opplag: { foreningsabonnement: 6111, betalt: 64, gratis: 200, distribuertTotalt: 6375, kilde: "Fagpressens Mediekontroll" },
    deadlines: "Bestillingsfrist august-utgave 18.8; materiell til 9.8; Eirik ferie i juli. Utgivelsesplan: 8 nr/år.",
    formatSpecs: "210x270mm, satsflate 174x220, 3 spalter, raster 60 linjer, utfallende.",
    bilagPerEks: { under30g: 8, over30g: 9 },
  } } });
  console.log("Tannlege: commission→field, ~20 format quotes logged, commercialExtra trimmed");

  // 4) TU/Digi: display CPM + newsletter are offered-but-unpriced → outstandingInfo.
  for (const id of [T.tu, T.digi]) {
    await prisma.title.update({ where: { id }, data: { outstandingInfo: ["display CPM (visningsbasert)", "nyhetsbrev ukespris", "produksjonskostnad TUM Studio"] } });
  }
  console.log("TU/Digi: outstandingInfo set");

  // 5) Hegnar Finansavisen/Kapital: content-in-display CPM + studio production
  //    are offered-but-unpriced → outstandingInfo.
  for (const id of [T.finansavisen, T.kapital]) {
    await prisma.title.update({ where: { id }, data: { outstandingInfo: ["content i display: superboard-CPM + produksjonspris", "estimat content-/produksjonspriser"] } });
  }
  console.log("Hegnar: outstandingInfo set");

  console.log("\nDone.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
