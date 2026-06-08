/** Polaris Media native/video prices from May Britt Røste (Salgssjef, Adresseavisen
 * Byråtjenester), e-post 2026-06-08. "Samme pris i alle avisene." CPM-priser.
 * Logger INBOUND ContactLog + native/video PriceQuotes (CPM, NOK) på de navngitte
 * Polaris-titlene, og setter offersNativeContent=true. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";

// Titles named in the original request + the responding paper.
const NAMES = ["Adresseavisen", "Varden", "Sør-Trøndelag", "Vestlandsnytt"];

const NOTE =
  "INBOUND 2026-06-08: May Britt Røste (Salgssjef Team Strategisk, Adresseavisen Byråtjenester, " +
  "may.britt.roste@adresseavisen.no, tlf 913 22 380) svarte på prisforespørsel (##SAS-133487##). " +
  "POLARIS MEDIA – samme native-/video-pris i alle avisene (CPM, NOK): " +
  "Native Premium CPM 345 (anbefales, høyest CTR); Native Standard CPM 260; " +
  "video Reels CPM 400; video Prerolls CPM 500. Kilde: annonseweb.adressa.no. " +
  "Hun ber om hvilken kunde/bransje for å spisse tilbudet (svar utestående). " +
  "PS fra henne: native har god CTR når innholdet er interessant.";

const QUOTES = [
  { name: "Native Premium", price: 345, desc: "Native Premium (anbefales for høyeste CTR). annonseweb.adressa.no/products/2780 – native-premium." },
  { name: "Native Standard", price: 260, desc: "Native Standard. annonseweb.adressa.no/products/2780 – native." },
  { name: "Video – Reels", price: 400, desc: "Video-native, Reels. annonseweb.adressa.no/products/3030 – reels." },
  { name: "Video – Prerolls", price: 500, desc: "Video-native, Prerolls. annonseweb.adressa.no/products/2780 – prerolls." },
];

async function main() {
  for (const n of NAMES) {
    const t = await prisma.title.findFirst({
      where: { countryCode: "NO", name: { equals: n, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (!t) { console.log(`! ${n}: not found in catalog (NO) — skipped`); continue; }

    await prisma.title.update({
      where: { id: t.id },
      data: { offersNativeContent: true },
    });

    const log = await createContactLog({
      titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: NOTE, actorId: ACTOR,
    });

    for (const q of QUOTES) {
      await logQuote({
        draftProductType: "NATIVE_ARTICLE",
        draftProductName: `${q.name} (Polaris Media – ${t.name})`,
        draftProductDesc: q.desc,
        contactLogId: log.id,
        price: q.price, currency: "NOK", priceUnit: "CPM",
        includedText: "Polaris Media standard – samme pris i alle avisene. Kilde: May Britt Røste / annonseweb.adressa.no.",
        recordedById: ACTOR,
      });
    }
    console.log(`${t.name}: INBOUND-logg + 4 CPM-quotes (345/260/400/500 NOK) + offersNative=true`);
  }
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
