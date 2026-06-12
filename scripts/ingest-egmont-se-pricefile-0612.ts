/** Ingest the Story House Egmont SE master price file (Prisuppgifter Story House
 * Egmont Sverige 2026.xlsx), sent by Thomas Sedin (Nordic KAM) 2026-06-09.
 * Source: the XLSX attachment, parsed to the tables below.
 *
 * Creates a "Print helsida (brutto)" product per matched SE title (idempotent —
 * skips titles that already have one), and stores the display-CPM + stand-alone-
 * newsletter rate-card detail in each title's commercialExtra so it is queryable
 * and never lost. Native is 30–40 000/article (already captured per title).
 * Match by exact name + market SE. Dry-run by default; --apply to write.
 */
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");
const SRC = "Story House Egmont prisfil 2026 (Thomas Sedin, e-post 2026-06-09)";

// Titel -> { print helsida brutto SEK, antal utgåvor }
const PRINT: Record<string, { pris: number; utg: number }> = {
  "Café": { pris: 57500, utg: 2 }, "King Magazine": { pris: 57500, utg: 6 }, "Hus & Hem": { pris: 58900, utg: 15 },
  "Auto Motor & Sport": { pris: 35000, utg: 12 }, "Praktiskt Båtägande": { pris: 22500, utg: 12 }, "Svensk Golf": { pris: 39000, utg: 12 },
  "Wheels": { pris: 17000, utg: 12 }, "V85 Guiden": { pris: 19000, utg: 52 }, "Husvagn & Camping": { pris: 18200, utg: 12 },
  "Hemmets Journal": { pris: 48400, utg: 52 }, "Hälsa": { pris: 39000, utg: 12 }, "Icakuriren": { pris: 71500, utg: 52 },
  "Scandinavian Retro": { pris: 29000, utg: 6 }, "Utemagasinet": { pris: 33000, utg: 10 }, "Vagabond": { pris: 39900, utg: 8 },
  "Åka Skidor": { pris: 35000, utg: 9 }, "Kalle Anka & Co": { pris: 15400, utg: 40 }, "Min Häst": { pris: 20000, utg: 19 },
};
// site -> {unika besökare/mån, topscroll CPM, midscroll CPM, standard CPM}; mapped to a title
const DISPLAY: { title: string; site: string; uv: number; top: number; mid: number; std: number }[] = [
  { title: "Hus & Hem", site: "hemtrevligt.se (portal Hus & Hem/Icakuriren m.fl.)", uv: 600000, top: 200, mid: 100, std: 50 },
  { title: "Auto Motor & Sport", site: "automotorsport.se", uv: 400000, top: 250, mid: 150, std: 60 },
  { title: "Svensk Golf", site: "svenskgolf.se", uv: 400000, top: 250, mid: 150, std: 60 },
  { title: "Praktiskt Båtägande", site: "praktiskbatagande.se", uv: 30000, top: 250, mid: 150, std: 60 },
  { title: "Åka Skidor", site: "akaskidor.se", uv: 50000, top: 250, mid: 150, std: 60 },
  { title: "Utemagasinet", site: "utemagasinet.se", uv: 30000, top: 250, mid: 150, std: 60 },
  { title: "Café", site: "café.se", uv: 300000, top: 250, mid: 150, std: 60 },
  { title: "King Magazine", site: "kingmagazine.se", uv: 50000, top: 250, mid: 150, std: 60 },
  { title: "Husvagn & Camping", site: "husvagnochcamping.se", uv: 30000, top: 250, mid: 150, std: 60 },
];
// title -> {mottagare, öre/mottagare standard, vid 3+}
const NEWSLETTER: Record<string, { mottagare: number; ore: number; ore3: number }> = {
  "Hus & Hem": { mottagare: 15000, ore: 50, ore3: 35 }, "Icakuriren": { mottagare: 33000, ore: 50, ore3: 35 },
  "Hälsa": { mottagare: 8000, ore: 50, ore3: 35 }, "Praktiskt Båtägande": { mottagare: 9000, ore: 50, ore3: 35 },
  "Auto Motor & Sport": { mottagare: 15000, ore: 50, ore3: 35 }, "Svensk Golf": { mottagare: 26000, ore: 50, ore3: 35 },
  "Husvagn & Camping": { mottagare: 10000, ore: 50, ore3: 35 }, "Hemmets Journal": { mottagare: 45000, ore: 50, ore3: 35 },
  "Åka Skidor": { mottagare: 8500, ore: 50, ore3: 35 }, "Utemagasinet": { mottagare: 8500, ore: 50, ore3: 35 },
  "Café": { mottagare: 10000, ore: 50, ore3: 35 }, "Vagabond": { mottagare: 17000, ore: 50, ore3: 35 },
};

async function main() {
  let printNew = 0, printSkip = 0, extra = 0, notFound = 0;
  for (const [name, { pris, utg }] of Object.entries(PRINT)) {
    const t = await prisma.title.findFirst({ where: { name, countryCode: "SE" }, select: { id: true, name: true, commercialExtra: true, products: { select: { id: true, name: true, type: true } } } });
    if (!t) { notFound++; console.log(`  NOT FOUND: ${name}`); continue; }
    const hasPrint = t.products.some((p) => p.type === "ADVERTORIAL" && /helsida/i.test(p.name) && /print|brutto/i.test(p.name));
    if (hasPrint) { printSkip++; }
    else {
      console.log(`  + print helsida ${name}: ${pris} SEK (${utg} utg)`);
      if (APPLY)
        await prisma.product.create({ data: { titleId: t.id, type: "ADVERTORIAL", name: "Print helsida (brutto)", description: `Helsidesannons i magasinet, ${utg} utgåvor/år. Brutto. Kilde: ${SRC}.`, pricingModel: "FLAT", basePrice: pris, currency: "SEK", visibility: "INDICATIVE", active: false, bookable: false, confirmedAt: new Date("2026-06-09T00:00:00.000Z"), confirmedSource: "EgmontPrisfil2026" } });
      printNew++;
    }
    // store display + newsletter detail in commercialExtra (never lost)
    const disp = DISPLAY.find((d) => d.title === name);
    const nl = NEWSLETTER[name];
    if (disp || nl) {
      const ce = { ...(typeof t.commercialExtra === "object" && t.commercialExtra ? t.commercialExtra : {}), egmontRateCard2026: { source: SRC, ...(disp ? { displayCpm: { site: disp.site, unikaBesokarePerMan: disp.uv, topscroll: disp.top, midscroll: disp.mid, standard: disp.std, formats: "980x300, 300x600, 320x480" } } : {}), ...(nl ? { standAloneNyhetsbrev: { mottagare: nl.mottagare, orePerMottagare: nl.ore, orePerMottagareVid3plus: nl.ore3 } } : {}), native: "30 000–40 000 kr/artikkel, aktiv på startside 2 uker, ligger ≥6 mnd, nyhetsbrev-listing + FB-push; tillägg: advertorial helside/uppslag, Instagram post+stories, FB-boost, publisering på flere sajter" } };
      if (APPLY) await prisma.title.update({ where: { id: t.id }, data: { commercialExtra: ce } });
      extra++;
    }
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — print products new: ${printNew} | print skipped(exists): ${printSkip} | commercialExtra updated: ${extra} | not found: ${notFound}`);
}
main().finally(() => prisma.$disconnect());
