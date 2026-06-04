/** Backfill aliases / keywords / description on titles processed before
 * those fields existed. Only sets the three enrichment fields. */
import { prisma } from "@/lib/prisma";

type E = { id: string; aliases: string[]; keywords: string[]; description: string };
const ROWS: E[] = [
  { id: "cmpmdiq9t01ig0hu0f5lj7zs5", aliases: ["FA", "Finansavisen.no"], keywords: ["næringsliv", "finans", "børs", "økonomi", "B2B", "native", "brand studio"], description: "Norges ledende næringslivsavis (print + FA.no). Kjøpesterkt publikum av ledere og beslutningstakere. FA Brand Studio leverer native (Readpeak), content, branded stories og studioproduksjon." },
  { id: "cmpmdiq9z01rl0hu0z78xy6wr", aliases: ["Kapital.no"], keywords: ["næringsliv", "finans", "investor", "økonomi", "magasin", "native"], description: "Ukentlig næringslivsmagasin (følger Finansavisen). Innflytelsesrike lesere; temautgaver bl.a. AI/Tech (10.04 og 20.11.2026), Eiendom og Norges 400 rikeste." },
  { id: "cmpmdiqa201we0hu07ls2kktr", aliases: ["NTFs Tidende", "Norsk Tannlegeforenings Tidende", "Tannlegetidende", "The Norwegian Dental Journal"], keywords: ["tannlege", "odontologi", "helse", "fagblad", "B2B"], description: "Fagtidsskrift for Den norske tannlegeforening. Når norske tannleger og studenter; opplag ~6 375, 8 nr/år. Annonsørinnhold (advertorial) må merkes «Annonse» + logo." },
  { id: "cmpmdiqaa02740hu0wmaem2bd", aliases: ["Teknisk Ukeblad", "TU", "Teknologi & Verkstedindustri"], keywords: ["teknologi", "industri", "ingeniør", "innovasjon", "B2B", "native"], description: "Norges viktigste nettsted for ny teknologi og teknologibransjen. 700 000 lesere/mnd; treffer ingeniører og beslutningstakere. TU Media." },
  { id: "cmpmdiq9y01qa0hu0r405b45z", aliases: ["Digi"], keywords: ["IT", "digitalisering", "teknologi", "B2B", "native"], description: "Norges eldste nettavis uten papiropphav (1996). Viktigste kilde til IT- og digital-nyheter; 300 000 lesere/mnd. TU Media." },
  { id: "cmpzi9boa00030harxck57b3d", aliases: ["Rytter", "NRYF"], keywords: ["hest", "ryttersport", "ridning", "display"], description: "Norges Rytterforbunds redaksjonelle side for ryttersporten. 200 000 visn./mnd, FB 23k / IG 18k. Kun display-annonsering (ikke annonsørinnhold)." },
  { id: "cmpzi9bqr00050harvgro7rk5", aliases: ["Nryfstevne", "NRYF stevne"], keywords: ["hest", "ryttersport", "stevne", "display"], description: "Norges Rytterforbunds stevne- og påmeldingsportal. 720 000 visn./mnd. Kun display-annonsering." },
];

async function main() {
  for (const r of ROWS) {
    await prisma.title.update({ where: { id: r.id }, data: { aliases: r.aliases, keywords: r.keywords, description: r.description } });
    console.log(`enriched ${r.id}`);
  }
  console.log("\nDone.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
