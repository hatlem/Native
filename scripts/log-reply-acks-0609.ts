/** 2026-06-09: log the 13 reply-acks I sent to the 2nd-wave price-givers as OUTBOUND
 * ContactLog entries (one per thread/representative title), so the contact timeline
 * reflects that we replied. Dup-guarded by note tag. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const TAG = "reply-ack 2026-06-09 (2nd wave)";

const ACKS: { slug: string; to: string; note: string }[] = [
  { slug: "galago-se", to: "anders@ordfrontforlag.se", note: "Svarade Anders: kunden branschrelevant aktör, vanlig annonsörsannons; återkommer vid skarp bokning efter sommaren (ingen brådska till morgondagens nummer)." },
  { slug: "sermitsiaq-dk", to: "annoncer@sermitsiaq.gl", note: "Ack til Hans P. Petersen: noterer sponsoreret artikel 25 000/28 260 til budgettet; konkret efter sommeren." },
  { slug: "chef-se", to: "patrik.mood@chef.se", note: "Ack til Patrik Mood: noterar native 57 750 + paket; avvaktar signering tills konkret kund/period (efter sommaren)." },
  { slug: "cafe-se", to: "erik@sb-media.se", note: "Ack til Erik Bergström: noterar native 45 000/30 000; konkret efter sommaren." },
  { slug: "altinget-dk", to: "mhb@altinget.dk", note: "Ack til Mads Holten Bonke: noterer model opsætning 3 000 + 15/læsning (gælder også Mandag Morgen); konkret efter sommeren." },
  { slug: "folkeskolen-dk", to: "fiwa@folkeskolen.dk", note: "Ack til Filip Wallfält: noterer DM nyhedsbrev 7 500, Gymnasieskolen 19 200 + online 10 000/mdr, Folkeskolen advertorial 25 000; konkret efter sommeren." },
  { slug: "la-kartidningen-se", to: "david@informa.se", note: "Ack til David Andreasson: noterar native 78 000/55 000/73 000; konkret efter sommaren." },
  { slug: "tipsbladet-dk", to: "tcalvo@bettercollective.com", note: "Ack til Tobias Calvo Jensen: noterer at de kun tilbyder links i artikler; vender tilbage hvis relevant." },
  { slug: "va-rlden-idag-se", to: "annons@varldenidag.se", note: "Ack til Johanna Köllerfors: noterar Dagstidning Native 25 000/32 500 + Digital Native 20 000; konkret efter sommaren." },
  { slug: "bioanalytikeren-dk", to: "hanne@media-partners.dk", note: "Ack til Hanne Kjærgaard (Media-Partners): noterer mediekit-priser (Sygeplejersken/Bioanalytikeren + Pharma/Farmaci/Lægeliv); konkret efter sommeren." },
  { slug: "proffs-se", to: "annons@vagpress.se", note: "Ack til Pekka Tikkanen: noterar print 1/1 22 800; hör av oss kring native-upplägg; konkret efter sommaren." },
  { slug: "idenyt-dk", to: "michael.nielsen@bonnier.dk", note: "Ack til Michael Nielsen: noterer native idenyt.dk 30 000/35 000/45 000 + øvrige brands; konkret efter sommeren." },
  { slug: "hus-hem-se", to: "thomas.sedin@egmont.se", note: "Ack til Thomas Sedin (Story House Egmont): noterar native 30–40k + helsidespriser; skarpare förslag när konkret kund/titlar finns (efter sommaren)." },
];

async function main() {
  for (const a of ACKS) {
    const t = await prisma.title.findFirst({ where: { slug: a.slug }, select: { id: true, name: true } });
    if (!t) { console.log(`! ${a.slug} not found`); continue; }
    const already = (await prisma.contactLog.count({ where: { titleId: t.id, direction: "OUTBOUND", note: { contains: TAG } } })) > 0;
    if (already) { console.log(`${t.name}: ack already logged`); continue; }
    await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "OUTBOUND", note: `OUTBOUND 2026-06-09 (→ ${a.to}): ${a.note} ${TAG}`, actorId: ACTOR });
    console.log(`${t.name}: ← OUTBOUND ack logged`);
  }
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
