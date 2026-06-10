/** 2026-06-09: create the Swedish title Journalisten (distinct from DK journalisten-dk) +
 * log Hans Simons' native nyhetsbrev price. Publisher Sveriges Journalistförbund (SE). Idempotent. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const SE_MARKET = "cmpmdiq3r00010hu0mbiqfmp0";

async function main() {
  // 1) Publisher
  let pub = await prisma.publisher.findFirst({ where: { name: "Sveriges Journalistförbund (SE)" } });
  if (!pub) pub = await prisma.publisher.create({ data: { name: "Sveriges Journalistförbund (SE)", countryCode: "SE", marketId: SE_MARKET } });

  // 2) Title (slug journalisten-se; DK one is journalisten-dk)
  let t = await prisma.title.findFirst({ where: { slug: "journalisten-se" }, select: { id: true, outstandingInfo: true } });
  if (!t) {
    const created = await prisma.title.create({ data: {
      name: "Journalisten", slug: "journalisten-se", publisherId: pub.id, marketId: SE_MARKET, countryCode: "SE",
      category: "Media/Fackpress", websiteUrl: "https://www.journalisten.se",
      offersNativeContent: true, ownContentAllowed: "YES",
      aliases: ["Journalisten SE", "Tidningen Journalisten"], keywords: ["journalistik", "media", "fackförbund"],
      description: "Sveriges Journalistförbunds tidning för journalister; native i nyhetsbrev (14 000 prenumeranter, 5x/vecka).",
      commercialExtra: { source: "Hans Simons / Annonssäljarna, e-post 2026-06-09", currency: "SEK", nativeNyhetsbrev: 26000, momsTillkommer: true, nyhetsbrev: { prenumeranter: 14000, frekvens: "5x/vecka" } },
      digitalReach: 14000, active: true, lastVerifiedAt: new Date(),
    }, select: { id: true, outstandingInfo: true } });
    t = created;
    console.log(`Created title Journalisten (SE) ${t.id} under ${pub.name}`);
  } else {
    console.log("Journalisten (SE) already exists:", t.id);
  }

  // 3) Contact log + quote + sales contact (dup-guarded)
  const TAG = "Journalisten SE nyhetsbrev-native 2026 (Hans Simons)";
  const already = (await prisma.contactLog.count({ where: { titleId: t.id, direction: "INBOUND", note: { contains: TAG } } })) > 0;
  if (!already) {
    const NOTE = "INBOUND 2026-06-09: Hans Simons (Annonssäljarna, Hans.Simons@annonssaljarna.se). Native-puff (rubrik/ingress/bild) i Journalistens nyhetsbrev " +
      "26 000 SEK + moms. Distribueras må-fre (5 ggr), 14 000 prenumeranter. (Universitetsläraren tillåter ej native.) " + TAG;
    const log = await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: NOTE, actorId: ACTOR });
    await logQuote({ draftProductType: "NATIVE_DISPLAY", draftProductName: "Native-puff i nyhetsbrev", draftProductDesc: "Rubrik/ingress/bild i Journalistens nyhetsbrev (14 000 pren, 5x/v). + moms.", contactLogId: log.id, price: 26000, currency: "SEK", priceUnit: "FLAT", includedText: NOTE.slice(0, 200), recordedById: ACTOR });
    let sc = await prisma.salesContact.findFirst({ where: { publisherId: pub.id, email: "hans.simons@annonssaljarna.se" } });
    if (!sc) sc = await createSalesContact({ publisherId: pub.id, name: "Hans Simons", email: "hans.simons@annonssaljarna.se", role: "Annonssäljarna (Journalisten/Universitetsläraren)", notes: "Native nyhetsbrev Journalisten 26 000+moms. 06-09.", actorId: ACTOR });
    await attachContactToTitle({ salesContactId: sc.id, titleId: t.id, isPrimary: true, actorId: ACTOR });
    console.log("Journalisten (SE): ← native nyhetsbrev 26 000 + Hans Simons");
  } else {
    console.log("Journalisten (SE): quote already logged");
  }
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
