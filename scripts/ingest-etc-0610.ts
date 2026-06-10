/** 2026-06-10: Jim Berg (ETC) — Dagens ETC native 30 000 SEK ex moms/artikel
 * (puff på ettan 100k visn/v i 3 v). ETC Magasin = nedlagt. Dup-guarded. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";

async function main() {
  // Dagens ETC — native 30 000 ex moms
  const TAG = "Dagens ETC native 2026 (Jim Berg)";
  const t = await prisma.title.findFirst({ where: { slug: "dagens-etc-se" }, select: { id: true, publisherId: true } });
  if (!t) { console.log("! Dagens ETC missing"); }
  else if ((await prisma.contactLog.count({ where: { titleId: t.id, direction: "INBOUND", note: { contains: TAG } } })) > 0) console.log("Dagens ETC: already");
  else {
    const NOTE = "INBOUND 2026-06-10: Jim Berg (Försäljningschef, etc.se, jim.berg@etc.se, 070-595 27 87). Native-artikel 30 000 SEK ex moms per artikel; ingår puff på ettan 100 000 visningar/vecka i tre veckor. ETC godkänner annonsör+innehåll redaktionellt. Native på ETC.se (ev. motsv. content i Dagens ETC print/e-tidning). " + TAG;
    await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, commercialExtra: { source: "Jim Berg / ETC, e-post 2026-06-10", currency: "SEK", nativeArtikel: 30000, priceType: "ex_moms", puffEttan: "100 000 visningar/vecka i 3 veckor", godkannande: "annonsör + innehåll redaktionellt" }, lastVerifiedAt: new Date() } });
    const log = await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: NOTE, actorId: ACTOR });
    await logQuote({ draftProductType: "NATIVE_ARTICLE", draftProductName: "Native-artikel (ETC.se)", draftProductDesc: "Puff på ettan 100k visn/v i 3 v. Ex moms.", contactLogId: log.id, price: 30000, currency: "SEK", priceUnit: "FLAT", includedText: NOTE.slice(0, 200), recordedById: ACTOR });
    let sc = await prisma.salesContact.findFirst({ where: { publisherId: t.publisherId, email: "jim.berg@etc.se" } });
    if (!sc) sc = await createSalesContact({ publisherId: t.publisherId, name: "Jim Berg", email: "jim.berg@etc.se", phone: "070-595 27 87", role: "Försäljningschef, etc.se", notes: "Native 30 000 ex moms/artikel. 06-10.", actorId: ACTOR });
    await attachContactToTitle({ salesContactId: sc.id, titleId: t.id, isPrimary: true, actorId: ACTOR });
    console.log("Dagens ETC: ← native 30 000 + Jim Berg");
  }
  // ETC Magasin — discontinued per Jim
  const m = await prisma.title.findFirst({ where: { slug: "etc-magasin-se" }, select: { id: true, active: true, outstandingInfo: true } });
  if (m && m.active !== false) {
    await prisma.title.update({ where: { id: m.id }, data: { active: false, outstandingInfo: { set: [...new Set([...(m.outstandingInfo ?? []), "Nedlagt – ETC Magasinet finns ej längre (Jim Berg, ETC, 2026-06-10)"])] } } });
    await createContactLog({ titleId: m.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-10: Jim Berg (ETC) bekräftar att ETC Magasinet inte längre finns → deaktiverad. ETC Magasin nedlagt 2026 (Jim Berg)", actorId: ACTOR });
    console.log("ETC Magasin: ← deaktivert (nedlagt)");
  } else console.log("ETC Magasin: already inactive/missing");
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
