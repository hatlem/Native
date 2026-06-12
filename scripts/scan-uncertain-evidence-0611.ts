/** Read-only evidence scan for the 2026-06-07 `uncertain` titles.
 *
 * Context: the catalog was seeded from an AI-compiled CSV that hallucinated
 * titles (e.g. "Annonsørforeningens magasin" off anfo.no). The 06-07 verification
 * flagged 215 as `uncertain` (note often "no hit / likely hallucinated") but the
 * apply step leaves `uncertain` ACTIVE pending human triage — so fakes still show.
 *
 * Before deactivating any of them we must not kill a REAL title. A price had to
 * come from somewhere, so ANY price/contact artifact = the title exists. We treat
 * `confirmedAt` as unreliable (often forgotten) and instead union every signal:
 *   - INBOUND contact log (publisher reply)            — ground truth
 *   - any PriceQuote on a product                      — a received price
 *   - product.confirmedAt OR confirmedSource set       — firmed price (either flag)
 *   - product.visibility != INDICATIVE                 — a non-placeholder price
 *   - QuoteLine referencing a product                  — quoted in a real plan
 *   - title.pricingAsOf / publishedRateCard set        — dated pricing on file
 *   - title.offersNativeContent != null                — learned from a reply
 *   - any RateCardDocument on the title                — media kit received
 *
 * Output: data/catalog/uncertain_evidence_0611.json with each title partitioned
 * into KEEP (has evidence → real) vs NEEDS_MAIL_CHECK (no DB evidence → verify in
 * Outlook before any deactivation). Read-only; writes nothing to the DB.
 *
 * Run: railway run --service Postgres sh -c \
 *   'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm tsx scripts/scan-uncertain-evidence-0611.ts'
 */
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

type Verdict = { id: string; name: string; market: string; status: string; note: string; evidenceUrl: string | null };
const { verdicts }: { verdicts: Verdict[] } = JSON.parse(
  readFileSync("data/catalog/catalog_verification_0607.json", "utf8"),
);

// Notes that positively signal the title likely does not exist.
const HALLUCINATION =
  /hallucinat|no hit|not a magazine|does not (exist|appear)|no evidence|cannot find|finner ikke|fant ikke|finnes ikke|ingen treff/i;

const uncertain = verdicts.filter((v) => v.status === "uncertain");

async function main() {
  const keep: any[] = [];
  const needsMail: any[] = [];
  let gone = 0;

  for (const v of uncertain) {
    const t = await prisma.title.findUnique({
      where: { id: v.id },
      select: {
        id: true, name: true, countryCode: true, active: true, discontinuedAt: true,
        pricingAsOf: true, publishedRateCard: true, offersNativeContent: true,
        websiteUrl: true,
        products: { select: { id: true, visibility: true, confirmedAt: true, confirmedSource: true, priceQuotes: { select: { id: true } } } },
        _count: { select: { contactLogs: true, rateCardDocuments: true } },
      },
    });
    if (!t) { gone++; continue; }
    if (t.discontinuedAt || !t.active) { gone++; continue; } // already settled

    const inbound = await prisma.contactLog.count({ where: { titleId: t.id, direction: "INBOUND" } });
    const productIds = t.products.map((p) => p.id);
    const quoteLines = productIds.length
      ? await prisma.quoteLine.count({ where: { productId: { in: productIds } } })
      : 0;
    const priceQuotes = t.products.reduce((n, p) => n + p.priceQuotes.length, 0);
    const firmedProducts = t.products.filter((p) => p.confirmedAt || p.confirmedSource || p.visibility !== "INDICATIVE").length;

    const signals: string[] = [];
    if (inbound) signals.push(`inbound:${inbound}`);
    if (priceQuotes) signals.push(`priceQuotes:${priceQuotes}`);
    if (firmedProducts) signals.push(`firmedProducts:${firmedProducts}`);
    if (quoteLines) signals.push(`quoteLines:${quoteLines}`);
    if (t.pricingAsOf) signals.push("pricingAsOf");
    if (t.publishedRateCard != null) signals.push("publishedRateCard");
    if (t.offersNativeContent != null) signals.push(`offersNative:${t.offersNativeContent}`);
    if (t._count.rateCardDocuments) signals.push(`rateCards:${t._count.rateCardDocuments}`);

    const row = {
      id: t.id, name: t.name, market: t.countryCode, websiteUrl: t.websiteUrl,
      hallucinationNote: HALLUCINATION.test(v.note), note: v.note, evidenceUrl: v.evidenceUrl,
      signals,
    };
    if (signals.length) keep.push(row);
    else needsMail.push(row);
  }

  const out = {
    scannedAt: "2026-06-11",
    source: "data/catalog/catalog_verification_0607.json",
    uncertainTotal: uncertain.length,
    alreadyGone: gone,
    keepWithEvidence: keep.length,
    needsMailCheck: needsMail.length,
    needsMailHallucination: needsMail.filter((r) => r.hallucinationNote).length,
    keep,
    needsMail,
  };
  writeFileSync("data/catalog/uncertain_evidence_0611.json", JSON.stringify(out, null, 2));

  console.log(`uncertain: ${uncertain.length} | already gone: ${gone}`);
  console.log(`KEEP (has price/contact evidence → real): ${keep.length}`);
  console.log(`NEEDS MAIL CHECK (no DB evidence): ${needsMail.length}  (of which hallucination-flagged: ${out.needsMailHallucination})`);
  console.log(`\n--- KEEP sample (real, do not touch) ---`);
  keep.slice(0, 12).forEach((r) => console.log(`  ✓ ${r.name} (${r.market})  [${r.signals.join(", ")}]`));
  console.log(`\n--- NEEDS MAIL CHECK sample ---`);
  needsMail.slice(0, 20).forEach((r) => console.log(`  ? ${r.name} (${r.market})${r.hallucinationNote ? "  ⚑hallucination-note" : ""}`));
  console.log(`\nWrote data/catalog/uncertain_evidence_0611.json`);
}

main().finally(() => prisma.$disconnect());
