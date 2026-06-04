/** Set pricingAsOf on titles whose price data we captured this session
 * (all from the 2026-06-04 reply wave). Derive from each title's latest
 * PriceQuote where possible; fall back to the known reply date. */
import { prisma } from "@/lib/prisma";

const PRICED = [
  "cmpmdiq9t01ig0hu0f5lj7zs5", // Finansavisen
  "cmpmdiq9z01rl0hu0z78xy6wr", // Kapital
  "cmpmdiqa201we0hu07ls2kktr", // Tidende
  "cmpmdiqaa02740hu0wmaem2bd", // TU.no
  "cmpmdiq9y01qa0hu0r405b45z", // Digi.no
  "cmpzi9boa00030harxck57b3d", // rytter.no
  "cmpzi9bqr00050harvgro7rk5", // nryfstevne.no
  "cmpmdiqa201v80hu00hq8n72n", // Avfallsbransjen
  "cmpmdiqa201vm0hu0vapf6l57", // Biogassbransjen
  "cmpmdiqa401y70hu0f5oxlgmq", // Hydrogen24
  "cmpmdiqa201w70hu0dm4ydxi7", // Cnytt
];
const REPLY_DATE = new Date("2026-06-04T00:00:00Z");

async function main() {
  for (const id of PRICED) {
    // Latest quote recorded against this title (via contact log or product).
    const latest = await prisma.priceQuote.findFirst({
      where: { OR: [{ contactLog: { titleId: id } }, { product: { titleId: id } }] },
      orderBy: { recordedAt: "desc" },
      select: { recordedAt: true },
    });
    const asOf = latest?.recordedAt ?? REPLY_DATE;
    await prisma.title.update({ where: { id }, data: { pricingAsOf: asOf } });
    console.log(`${id}: pricingAsOf = ${asOf.toISOString().slice(0, 10)}`);
  }
  console.log("\nDone.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
