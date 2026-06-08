/** 2026-06-08 Aller SE reach/demographics from "Alla varumärken - Aller.pdf" (WeTransfer mediekit).
 * Source: Orvesto Konsument 2024:Helår + Google Analytics genomsnittlig vecka feb 2025.
 * Backed up at docs/outreach-sources/aller/Alla varumarken - Aller 2026.pdf.
 * Merges into existing commercialExtra (preserves pricing). digitalReach set only for own-site figures. */
import { prisma } from "@/lib/prisma";

async function update(name: string, digitalReach: number | null, note: string, audience: Record<string, unknown>) {
  const t = await prisma.title.findFirst({ where: { name: { equals: name, mode: "insensitive" }, countryCode: "SE" }, select: { id: true, commercialExtra: true } });
  if (!t) { console.log(`! ${name} not found`); return; }
  const ce = (t.commercialExtra && typeof t.commercialExtra === "object" ? t.commercialExtra : {}) as Record<string, unknown>;
  await prisma.title.update({ where: { id: t.id }, data: {
    ...(digitalReach != null ? { digitalReach } : {}),
    audienceNote: note,
    commercialExtra: { ...ce, audience: { ...audience, source: "Orvesto Konsument 2024:Helår + GA feb 2025 (Aller mediekit)" } },
  } });
  console.log(`${name}: reach${digitalReach != null ? ` ${digitalReach}` : ""} + audience merged`);
}

async function main() {
  await update("Allas", 378000,
    "allas.se: 378 000 nettoräckvidd/v (263 399 unika besökare, 1 487 477 sidv, snitt 02:14). Magasin 175 000, totalt 506 000. 77% kvinnor digital / 82% print (mitt i livet, 46-65). Källa Orvesto 2024/GA feb-25.",
    { site: "allas.se", digitalNettoVecka: 378000, unikaBesokareVecka: 263399, sidvisningar: 1487477, snittTid: "02:14", videostart: 511459, magasin: 175000, totalt: 506000, kvinnorDigital: "77%" });
  await update("Femina", 192000,
    "femina.se: 192 000 nettoräckvidd/v (287 389 unika besökare, 1 128 303 sidv, snitt 02:02). Magasin 111 000, totalt 249 000. 82% kvinnor digital / 89% print. Sveriges största livsstilsmagasin för kvinnor.",
    { site: "femina.se", digitalNettoVecka: 192000, unikaBesokareVecka: 287389, sidvisningar: 1128303, snittTid: "02:02", videostart: 423639, magasin: 111000, totalt: 249000, kvinnorDigital: "82%" });
  await update("MåBra", 95000,
    "mabra.com: 95 000 nettoräckvidd/v (144 743 unika besökare, 472 625 sidv, snitt 01:56). Magasin 138 000, totalt 218 000. 72% kvinnor digital / 82% print. Dominerande inom hälsa.",
    { site: "mabra.com", digitalNettoVecka: 95000, unikaBesokareVecka: 144743, sidvisningar: 472625, snittTid: "01:56", videostart: 219446, magasin: 138000, totalt: 218000, kvinnorDigital: "72%" });
  await update("Hänt i Veckan", 485000,
    "hant.se: 485 000 nettoräckvidd/v (467 837 unika besökare, 3 005 195 sidv, snitt 01:49, >1 mn besökare/v). 60% kvinnor digital. Sveriges toppsida för nöje/underhållning, köpstark målgrupp.",
    { site: "hant.se", digitalNettoVecka: 485000, unikaBesokareVecka: 467837, sidvisningar: 3005195, snittTid: "01:49", videostart: 2072448, kvinnorDigital: "60%", note: ">1 miljon unika besökare/vecka" });
  await update("Hänt Extra", null,
    "Print kändistidning: magasin nettoräckvidd 106 000 (52 utg/år), totalt med hant.se 571 000. 79% kvinnor. Native helsida/uppslag når 171 000 rv per insert.",
    { print: true, magasin: 106000, totaltMedHantSe: 571000, kvinnor: "79%", rvPerInsert: 171000, kandisarIndex: 315 });
  await update("Svensk Damtidning", 512000,
    "svenskdam.se: 512 000 nettoräckvidd/v (451 836 unika besökare, 3 585 612 sidv, snitt 01:42). Magasin 116 000. 60% kvinnor digital / 85% print. Kungligheter & svensk nöjesvärld (kungligheter-index 471).",
    { site: "svenskdam.se", digitalNettoVecka: 512000, unikaBesokareVecka: 451836, sidvisningar: 3585612, snittTid: "01:42", videostart: 6152539, magasin: 116000, kvinnorDigital: "60%", kvinnorPrint: "85%", kungligheterIndex: 471 });
  await update("ELLE Sverige", 318000,
    "elle.se: 318 000 nettoräckvidd/v (362 648 unika besökare, 1 925 631 sidv, snitt 02:01). Magasin 112 000, totalt 392 000. 83% kvinnor digital / 87% print. Sveriges främsta modeplattform; elle.se delas med ELLE Decoration & ELLE Mat & Vin.",
    { site: "elle.se", digitalNettoVecka: 318000, unikaBesokareVecka: 362648, sidvisningar: 1925631, snittTid: "02:01", videostart: 511388, magasin: 112000, totalt: 392000, kvinnorDigital: "83%", sharedWith: ["ELLE Decoration", "ELLE Mat & Vin"] });
  // ELLE Decoration & ELLE Mat & Vin share elle.se (318 000) — record but DON'T overwrite own digitalReach.
  await update("ELLE Decoration", null,
    "Magasin 84 000, totalt 378 000. 78% kvinnor. Eget site elledecoration.se; digital räckvidd räknas via delad elle.se-plattform (318 000 nettoräckvidd/v). Källa Orvesto 2024.",
    { ownSite: "elledecoration.se", sharedSite: "elle.se", sharedDigitalNettoVecka: 318000, magasin: 84000, totalt: 378000, kvinnor: "78%" });
  await update("ELLE Mat & Vin", null,
    "Magasin 100 000. 77% kvinnor. Digital via delad elle.se-plattform (mat&vin-sektion, 318 000 nettoräckvidd/v). Recept.se i nätverket: 636 000 nettoräckvidd/v. Källa Orvesto 2024.",
    { sharedSite: "elle.se", sharedDigitalNettoVecka: 318000, magasin: 100000, kvinnor: "77%", networkReceptSeVecka: 636000 });
  await update("Residence", 25000,
    "residencemagazine.se: 25 000 nettoräckvidd/v (18 803 unika besökare, 42 082 sidv, snitt 01:15). Magasin 63 000, totalt 94 000. 64% kvinnor digital / 66% print. Ledande för arkitektur/design/inredning.",
    { site: "residencemagazine.se", digitalNettoVecka: 25000, unikaBesokare: 18803, sidvisningar: 42082, snittTid: "01:15", videostart: 19775, magasin: 63000, totalt: 94000, kvinnorDigital: "64%" });
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
