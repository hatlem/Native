#!/usr/bin/env tsx
/**
 * Loads the researched sales-house advertising contacts (the machine-readable
 * form of docs/sales-house-routing.md) into SalesContact rows for every
 * IN_HOUSE / REP title whose ad sales run through one of those houses.
 *
 * Why this exists: for IN_HOUSE/REP titles the scraped per-title candidate is
 * the WRONG door (an editorial inbox). The right door is the publisher group's
 * ad department / rep house. That routing only lived in markdown; this script
 * puts it in the DB so the campaign engine can use it.
 *
 * Matching is on the EXACT `adSales` string — Aller / Egmont / Bauer each split
 * into per-market houses (NO/SE/DK/UK/DE) with different inboxes, so an ILIKE
 * would cross wires. Only researched houses are mapped; the long tail (≈470
 * smaller houses, plus academic Universitetsforlaget) is intentionally left
 * blank rather than guessed.
 *
 * Run:  pnpm tsx scripts/load-sales-house-contacts.ts          (dry-run)
 *       APPLY=1 pnpm tsx scripts/load-sales-house-contacts.ts  (write)
 *
 * Idempotent — SalesContact is get-or-created per (publisher, email) and the
 * title link is upserted, so reruns are no-ops.
 */
import { prisma } from "@/lib/prisma";
import { createSalesContact, attachContactToTitle, normaliseEmail } from "@/lib/pricing/contacts";

const APPLY = process.env.APPLY === "1";
const ACTOR_ID = process.env.ACTOR_ID || "cmpmdiqtg048c0hu080m8kmok"; // superadmin@nativespin.com

type Conf = "high" | "medium" | "low";
type Route = { adSales: string; email: string; name: string; role: string; confidence: Conf };

// Keyed on the exact `adSales` value in the catalog. Source: docs/sales-house-routing.md.
const ROUTES: Route[] = [
  // ── In-house ad arms (publisher group's own department) ────────────────────
  { adSales: "Amedia Salg", email: "marked@amedia.no", name: "Amedia Salg", role: "Annonsesalg", confidence: "high" },
  { adSales: "Sanoma Media Finland Mainosmyynti", email: "digimedia@sanoma.fi", name: "Sanoma Media Finland", role: "Mainosmyynti", confidence: "high" },
  { adSales: "Bauer Media Commercial", email: "advertising@bauermedia.co.uk", name: "Bauer Media Commercial (UK)", role: "Advertising", confidence: "high" },
  { adSales: "Future Commercial", email: "advertising@futurenet.com", name: "Future Commercial", role: "Advertising", confidence: "high" },
  { adSales: "JP/Politikens Hus Annonce", email: "annonce@jp.dk", name: "JP/Politikens Hus", role: "Annonce", confidence: "high" },
  { adSales: "Egmont Publishing DK Annonce", email: "annoncesalg@egmontmagasiner.dk", name: "Egmont Publishing DK", role: "Annoncesalg", confidence: "high" },
  { adSales: "Ad Alliance", email: "Verkaufsbuero.Hamburg@ad-alliance.de", name: "Ad Alliance", role: "Verkaufsbüro", confidence: "high" },
  { adSales: "Aller Media Annonsförsäljning", email: "erik.hamberg@aller.com", name: "Erik Hamberg (Aller Media SE)", role: "Head of Revenue", confidence: "high" },
  { adSales: "Polaris Media Salg / SMS (samarbeid)", email: "paal.munkvold@adresseavisen.no", name: "Pål Munkvold (Polaris Media)", role: "Annonsedirektør", confidence: "medium" },
  { adSales: "Otavamedia Mainosmyynti", email: "asiakaspalvelu@otavamedia.fi", name: "Otavamedia", role: "Mainosmyynti", confidence: "medium" },
  { adSales: "Jysk Fynske Medier Annonce", email: "kundeservice@jfm.dk", name: "Jysk Fynske Medier", role: "Annonce", confidence: "medium" },
  { adSales: "Immediate Commercial", email: "enquiries@immediate.co.uk", name: "Immediate Commercial", role: "Advertising", confidence: "low" },

  // ── Named sellers — the 8 groups that publish no generic ad inbox ──────────
  { adSales: "Schibsted Marketing Services (SMS)", email: "ellen.cabrinetti@schibsted.com", name: "Ellen Cabrinetti Meum (Schibsted Partnerstudio)", role: "Head, native studio", confidence: "high" },
  { adSales: "Aller Media Annonsesalg", email: "chris.talleras.steen@aller.com", name: "Chris Tallerås Steen (Aller Media NO)", role: "Salgsdirektør", confidence: "high" },
  { adSales: "Bonnier News Brands", email: "mats.dicklen@bonniernews.se", name: "Mats Dicklén (Bonnier News Brands)", role: "Head of Brand Studio", confidence: "medium" },
  { adSales: "Reach Commercial", email: "mark.field@reachplc.com", name: "Mark Field (Reach Studio)", role: "Director, branded content", confidence: "medium" },
  { adSales: "Newsquest Commercial", email: "sean.duffy@newsquest.co.uk", name: "Sean Duffy (Newsquest)", role: "Commercial Director", confidence: "medium" },
  { adSales: "Egmont Publishing Annonse", email: "ann-elise.ertesvag@egmont.com", name: "Ann-Elise Ertesvåg (Egmont NO)", role: "Commercial", confidence: "high" },
  { adSales: "Bauer Advertising KG", email: "frank.froehling@baueradvance.com", name: "Frank Fröhling (Bauer Advance DE)", role: "CSO / MD", confidence: "medium" },

  // ── Independent rep houses (true middlemen) ────────────────────────────────
  { adSales: "HS Media AS", email: "heisan@hsmedia.no", name: "HS Media", role: "Rep house", confidence: "medium" },
  { adSales: "A2 Media AS", email: "post@a2media.no", name: "A2 Media", role: "Rep house", confidence: "medium" },
  { adSales: "Salgsfabrikken AS", email: "huser@salgsfabrikken.no", name: "Salgsfabrikken", role: "Rep house", confidence: "medium" },
  { adSales: "Iconic Media Sales", email: "garry.mernagh@iconicnews.ie", name: "Garry Mernagh (Iconic Media IE)", role: "Regional Sales Director", confidence: "medium" },

  // ── Long-tail houses (Sonnet research swarm, 2026-05-30) — all MX-verified ──
  { adSales: "Bonnier Publications DK Annonce", email: "michaeln@idenyt.dk", name: "Michael Nielsen (Bonnier Publications DK Annonce)", role: "Salgsansvarlig", confidence: "high" },
  { adSales: "Ringier Advertising", email: "marketing@ringier.ch", name: "Ringier Advertising", role: "Advertising", confidence: "high" },
  { adSales: "Mediahuis Ireland Advertising", email: "advertise@mediahuis.ie", name: "Mediahuis Ireland Advertising", role: "General advertising inbox", confidence: "high" },
  { adSales: "Gota Media Annonsförsäljning", email: "annonssupport@gotamedia.se", name: "Gota Media Annonsförsäljning", role: "Annons support", confidence: "high" },
  { adSales: "National World Commercial", email: "hello@mediaconcierge.co.uk", name: "National World Commercial", role: "General / commercial contact", confidence: "high" },
  { adSales: "Aller Media DK Annonce", email: "mediesalg@aller.dk", name: "Aller Media DK Annonce", role: "Media Sales", confidence: "high" },
  { adSales: "NWT Annonsförsäljning", email: "mediepartner@ernamedia.se", name: "NWT Annonsförsäljning", role: "General advertising/media-sales inbox", confidence: "high" },
  { adSales: "LO Media", email: "andrine.wefring@lomedia.no", name: "Andrine Wefring (LO Media)", role: "Annonser", confidence: "high" },
  { adSales: "Media Impact", email: "kontakt@media-impact.de", name: "Media Impact", role: "Advertising", confidence: "high" },
  { adSales: "Bonnier Publications Norge", email: "cecilie.konterud@bonnier.no", name: "Cecilie Konterud (Bonnier Publications Norge)", role: "Markedssjef BO BEDRE", confidence: "high" },
  { adSales: "NTM Annonsförsäljning", email: "bokaannons@ntmmedia.se", name: "NTM Annonsförsäljning", role: "General advertising booking inbox", confidence: "high" },
  { adSales: "Haymarket Commercial", email: "james.butters@haymarket.com", name: "James Butters (Haymarket Commercial)", role: "Group Commercial Director, Campaign", confidence: "high" },
  { adSales: "Funke Media Sales", email: "sales-info@funkemedien.de", name: "Funke Media Sales", role: "Advertising", confidence: "high" },
  { adSales: "MPS Anzeigen", email: "ga9999@motorpresse.de", name: "MPS Anzeigen", role: "Anzeigen", confidence: "high" },
  { adSales: "Mitt i Media Annons", email: "annons@mitti.se", name: "Mitt i Media Annons", role: "Advertising inbox", confidence: "high" },
  { adSales: "Madsack Verlagsgesellschaft", email: "team@madsack-agentur.de", name: "Madsack Verlagsgesellschaft", role: "MADSACK Medienagentur — in-house advertisi", confidence: "high" },
  { adSales: "Alma Media Mainosmyynti", email: "myynti@almamedia.fi", name: "Alma Media Mainosmyynti", role: "Advertising sales", confidence: "high" },
  { adSales: "LRF Media Annonsförsäljning", email: "josefine.blomquist@lrfmedia.se", name: "Josefine Blomquist (LRF Media Annonsförsäljning)", role: "Sales Chief", confidence: "high" },
  { adSales: "Tun Media Annonse", email: "christian.lind@tunmedia.no", name: "Christian Lind (Tun Media Annonse)", role: "Direktør for salg og byrå", confidence: "high" },
  { adSales: "Klambt Anzeigen", email: "jan.magatzki@klambt.de", name: "Jan Magatzki (Klambt Anzeigen)", role: "Managing Director Media Sales", confidence: "high" },
  { adSales: "DK Anzeigen", email: "jan.magatzki@klambt.de", name: "Jan Magatzki (DK Anzeigen)", role: "Managing Director Media Sales", confidence: "high" },
  { adSales: "DMG Media Ireland Advertising", email: "advertising@dmgmedia.ie", name: "DMG Media Ireland Advertising", role: "General advertising inbox", confidence: "high" },
  { adSales: "CH Media Sales", email: "werbung@chmedia.ch", name: "CH Media Sales", role: "General advertising / media planning inqui", confidence: "high" },
  { adSales: "Polaris Media Sverige Annons", email: "foretag@stampen.com", name: "Polaris Media Sverige Annons", role: "Advertising / media sales inbox", confidence: "high" },
  { adSales: "Sjællandske Medier Annonce", email: "storkunde.salg@sn.dk", name: "Sjællandske Medier Annonce", role: "Annonceafdeling for landsdækkende annoncer", confidence: "high" },
  { adSales: "FT Commercial", email: "adcopy@ft.com", name: "FT Commercial", role: "Ad copy submissions / advertising contact", confidence: "high" },
  { adSales: "Konradin Anzeigen", email: "bm.anzeigen@konradin.de", name: "Konradin Anzeigen", role: "Anzeigenabteilung", confidence: "high" },
  { adSales: "Svenska Docu Media Annons", email: "jon.ost@byggvarlden.se", name: "Jon Öst (Svenska Docu Media Annons)", role: "Sales", confidence: "high" },
  { adSales: "A-lehdet Mainosmyynti", email: "yritysasiakkaat@a-lehdet.fi", name: "A-lehdet Mainosmyynti", role: "Corporate/advertising sales inbox — used f", confidence: "high" },
  { adSales: "Mentor Medier Salg", email: "annonse@vl.no", name: "Mentor Medier Salg", role: "Advertising inbox", confidence: "high" },
  { adSales: "Sörmlands Media Annons", email: "bokaannons@ntmmedia.se", name: "Sörmlands Media Annons", role: "Advertising booking inbox", confidence: "high" },
  { adSales: "Kaleva Media Mainosmyynti", email: "yrityksille@kalevamedia.fi", name: "Kaleva Media Mainosmyynti", role: "General advertising/business-services inbo", confidence: "high" },
  { adSales: "I-Mediat Mainosmyynti", email: "yrityksille@kalevamedia.fi", name: "I-Mediat Mainosmyynti", role: "Business / advertising sales inbox", confidence: "high" },
  { adSales: "LV Anzeigen", email: "mediamarketing@lv.de", name: "Gabriele Wittkowski (LV Anzeigen)", role: "Leitung Media Sales", confidence: "high" },
  { adSales: "VGN Anzeigen", email: "hofer-hoi.bastian@vgn.at", name: "Bastian Hofer-Hoi (VGN Anzeigen)", role: "Director Sales", confidence: "high" },
  { adSales: "News UK Commercial", email: "advertisingoperations@news.co.uk", name: "News UK Commercial", role: "Advertising Operations", confidence: "high" },
  { adSales: "TS-Yhtymä Mainosmyynti", email: "ilmoitukset@ts.fi", name: "TS-Yhtymä Mainosmyynti", role: "Print advertising submissions inbox", confidence: "high" },
  { adSales: "Lärartidningar Annonsförsäljning", email: "kontakt@rabaldermedia.se", name: "Lärartidningar Annonsförsäljning", role: "Advertising sales", confidence: "high" },
  { adSales: "Egmont Publishing Annons", email: "saljavdelningen@egmont.se", name: "Egmont Publishing Annons", role: "Försäljningsavdelningen", confidence: "high" },
  { adSales: "Spiegel Verlag Anzeigen", email: "sales-intelligence@iqm.de", name: "Spiegel Verlag Anzeigen", role: "Anzeigenvermarktung", confidence: "high" },
  { adSales: "William Reed Commercial", email: "adops@wrbm.com", name: "William Reed Commercial", role: "Ad Operations", confidence: "high" },
  { adSales: "VF Anzeigen", email: "b.schonauer@vfmz.de", name: "Bastian Schonauer (VF Anzeigen)", role: "Head of Sales", confidence: "high" },
  { adSales: "Reach Ireland Advertising", email: "info@reachsolutionsireland.com", name: "Reach Ireland Advertising", role: "General advertising/sales inbox", confidence: "high" },
  { adSales: "Hegnar Media Salg", email: "oliver.brenden@hegnar.no", name: "Oliver Brenden (Hegnar Media Salg)", role: "Rådgiver", confidence: "high" },
  { adSales: "News Ireland Advertising", email: "salesteam@newsireland.com", name: "News Ireland Advertising", role: "Commercial / Advertising Sales Team", confidence: "high" },
  { adSales: "WBV Anzeigen", email: "anzeigen@wbv.de", name: "WBV Anzeigen", role: "Anzeigenverwaltung", confidence: "high" },
];

const routeByAdSales = new Map(ROUTES.map((r) => [r.adSales, r]));

// Get-or-create a SalesContact for (publisher, email); createSalesContact uses
// plain create() and would throw on the @@unique, so guard with a lookup.
async function getOrCreateSalesContact(publisherId: string, route: Route): Promise<string> {
  const email = normaliseEmail(route.email);
  const existing = await prisma.salesContact.findUnique({
    where: { publisherId_email: { publisherId, email } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const sc = await createSalesContact({
    publisherId,
    email,
    name: route.name,
    role: route.role,
    notes: `Sales-house routing (${route.confidence}); via docs/sales-house-routing.md`,
    actorId: ACTOR_ID,
  });
  return sc.id;
}

async function main() {
  console.log(`[load-sales-house] ${APPLY ? "APPLY" : "DRY-RUN"} — ${ROUTES.length} routes`);

  const titles = await prisma.title.findMany({
    where: { salesChannel: { in: ["IN_HOUSE", "REP"] }, adSales: { in: [...routeByAdSales.keys()] } },
    select: { id: true, publisherId: true, adSales: true },
  });

  // Coverage report
  const totalNonDirect = await prisma.title.count({ where: { salesChannel: { in: ["IN_HOUSE", "REP"] } } });
  const perHouse = new Map<string, number>();
  for (const t of titles) perHouse.set(t.adSales!, (perHouse.get(t.adSales!) ?? 0) + 1);

  let contactsCreated = 0;
  let titlesLinked = 0;
  const scCache = new Map<string, string>(); // publisherId|email -> salesContactId

  for (const t of titles) {
    const route = routeByAdSales.get(t.adSales!)!;
    const key = `${t.publisherId}|${normaliseEmail(route.email)}`;
    let scId = scCache.get(key);
    if (!scId) {
      if (APPLY) {
        const before = await prisma.salesContact.findUnique({
          where: { publisherId_email: { publisherId: t.publisherId, email: normaliseEmail(route.email) } },
          select: { id: true },
        });
        scId = await getOrCreateSalesContact(t.publisherId, route);
        if (!before) contactsCreated++;
      } else {
        scId = "dry";
        contactsCreated++; // upper-bound estimate in dry-run (one per publisher|email)
      }
      scCache.set(key, scId);
    }
    if (APPLY) {
      await attachContactToTitle({ salesContactId: scId, titleId: t.id, isPrimary: true, actorId: ACTOR_ID });
    }
    titlesLinked++;
  }

  console.log("\n── Coverage by house ──");
  for (const [house, n] of [...perHouse.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(String(n).padStart(4), "|", house);
  }
  console.log("\n── Summary ──");
  console.log("non-direct titles total :", totalNonDirect);
  console.log("titles mapped & linked  :", titlesLinked);
  console.log("unmapped (long tail)    :", totalNonDirect - titlesLinked, "(no verified email — left for research)");
  console.log(APPLY ? "SalesContacts created   :" : "SalesContacts (est.)    :", contactsCreated);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
