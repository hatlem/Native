/** Create 7 real Story House Egmont SE titles that the master price file
 * (Prisuppgifter Story House Egmont 2026.xlsx, Thomas Sedin 2026-06-09) lists but
 * which are absent from the catalog. Publisher-confirmed via the official rate card,
 * so they land verificationStatus LIVE with that source. Each gets: a Print helsida
 * (brutto) product, a Native article product (Egmont native 30k floor), and the
 * display-CPM + newsletter rate-card detail in commercialExtra.
 * Idempotent: skips a title if a SE title of that name already exists.
 * Dry-run by default; --apply to write.
 */
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");
const PUBLISHER = "cmpmdiq5800ns0hu0f2u9c0sp"; // Egmont (SE)
const MARKET = "cmpmdiq3r00010hu0mbiqfmp0";    // SE
const SRC = "Story House Egmont prisfil 2026 (Thomas Sedin, e-post 2026-06-09)";

type T = {
  name: string; slug: string; url: string; category: string; vertical: string; audience: string; freq: string;
  print: number; utg: number; native: number;
  display?: { site: string; uv: number; top: number; mid: number; std: number };
  nl?: { mottagare: number; ore: number; ore3: number };
};
const TITLES: T[] = [
  { name: "Praktiskt Båtägande", slug: "praktiskt-batagande-se", url: "https://www.praktiskbatagande.se", category: "Båt", vertical: "Boating", audience: "Boat owners", freq: "12x/år", print: 22500, utg: 12, native: 30000, display: { site: "praktiskbatagande.se", uv: 30000, top: 250, mid: 150, std: 60 }, nl: { mottagare: 9000, ore: 50, ore3: 35 } },
  { name: "Svensk Golf", slug: "svensk-golf-se", url: "https://www.svenskgolf.se", category: "Golf", vertical: "Sport (Golf)", audience: "Golfers", freq: "12x/år", print: 39000, utg: 12, native: 30000, display: { site: "svenskgolf.se", uv: 400000, top: 250, mid: 150, std: 60 }, nl: { mottagare: 26000, ore: 50, ore3: 35 } },
  { name: "Wheels", slug: "wheels-se", url: "https://www.wheelsmagazine.se", category: "Bil", vertical: "Auto & Motor", audience: "Car enthusiasts", freq: "12x/år", print: 17000, utg: 12, native: 30000 },
  { name: "V85 Guiden", slug: "v85-guiden-se", url: "https://www.storyhouseegmont.se", category: "Trav", vertical: "Horse racing (trav)", audience: "Trotting / betting", freq: "52x/år", print: 19000, utg: 52, native: 30000 },
  { name: "Hälsa", slug: "halsa-se", url: "https://www.halsa.se", category: "Helse", vertical: "Health & Wellness", audience: "Health-interested consumers", freq: "12x/år", print: 39000, utg: 12, native: 30000, nl: { mottagare: 8000, ore: 50, ore3: 35 } },
  { name: "Scandinavian Retro", slug: "scandinavian-retro-se", url: "https://www.scandinavianretro.se", category: "Livsstil", vertical: "Lifestyle (Retro)", audience: "Retro / design consumers", freq: "6x/år", print: 29000, utg: 6, native: 30000 },
  { name: "Utemagasinet", slug: "utemagasinet-se", url: "https://www.utemagasinet.se", category: "Friluft", vertical: "Outdoor", audience: "Outdoor / hiking consumers", freq: "10x/år", print: 33000, utg: 10, native: 30000, display: { site: "utemagasinet.se", uv: 30000, top: 250, mid: 150, std: 60 }, nl: { mottagare: 8500, ore: 50, ore3: 35 } },
];

async function main() {
  let created = 0, skipped = 0;
  for (const t of TITLES) {
    const exists = await prisma.title.findFirst({ where: { name: t.name, countryCode: "SE" }, select: { id: true } });
    if (exists) { skipped++; console.log(`  SKIP (exists): ${t.name}`); continue; }
    const ce = {
      egmontRateCard2026: {
        source: SRC,
        native: "30 000–40 000 kr/artikkel; aktiv på startside 2 uker, ligger ≥6 mnd, nyhetsbrev-listing + FB-push; tillägg: advertorial helside/uppslag, Instagram, FB-boost, fler-sajt.",
        ...(t.display ? { displayCpm: { site: t.display.site, unikaBesokarePerMan: t.display.uv, topscroll: t.display.top, midscroll: t.display.mid, standard: t.display.std, formats: "980x300, 300x600, 320x480" } } : {}),
        ...(t.nl ? { standAloneNyhetsbrev: { mottagare: t.nl.mottagare, orePerMottagare: t.nl.ore, orePerMottagareVid3plus: t.nl.ore3 } } : {}),
      },
    };
    console.log(`  + CREATE ${t.name} (print ${t.print}, native ${t.native}${t.display ? ", +display" : ""}${t.nl ? ", +nl" : ""})`);
    if (APPLY)
      await prisma.title.create({
        data: {
          name: t.name, slug: t.slug, publisherId: PUBLISHER, marketId: MARKET, countryCode: "SE",
          category: t.category, vertical: t.vertical, audience: t.audience, type: "Magasin", frequency: t.freq,
          ownerGroup: "Story House Egmont", publisherName: "Story House Egmont", adSales: "Story House Egmont Sälj",
          salesChannel: "IN_HOUSE", websiteUrl: t.url, b2bB2c: "B2C", reach: "National", format: "Print + Digital",
          nativeFit: "High", urlStatus: "LIKELY_OK", offersNativeContent: true, pricesPublic: true,
          active: true, verificationStatus: "LIVE", verificationSource: SRC, lastVerifiedAt: new Date("2026-06-09T00:00:00.000Z"),
          pricingAsOf: new Date("2026-06-09T00:00:00.000Z"), commercialExtra: ce,
          products: {
            create: [
              { type: "NATIVE_ARTICLE", name: "Native artikel (per sajt)", description: `Native-artikkel produsert utifrån brief, publiseres på sajt. 30 000–40 000 kr (varierer per sajt). Kilde: ${SRC}.`, pricingModel: "FLAT", basePrice: t.native, currency: "SEK", visibility: "INDICATIVE", active: false, bookable: false, confirmedAt: new Date("2026-06-09T00:00:00.000Z"), confirmedSource: "EgmontPrisfil2026" },
              { type: "ADVERTORIAL", name: "Print helsida (brutto)", description: `Helsidesannons i magasinet, ${t.utg} utgåvor/år. Brutto. Kilde: ${SRC}.`, pricingModel: "FLAT", basePrice: t.print, currency: "SEK", visibility: "INDICATIVE", active: false, bookable: false, confirmedAt: new Date("2026-06-09T00:00:00.000Z"), confirmedSource: "EgmontPrisfil2026" },
            ],
          },
        },
      });
    created++;
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — created: ${created} | skipped: ${skipped}`);
}
main().finally(() => prisma.$disconnect());
