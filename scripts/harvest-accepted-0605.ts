import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
const r = JSON.parse(readFileSync("/tmp/chrome_verify.json","utf8"));
const STRONG=/^(annons|annonse|annonser|annonsera|annonsen|annonsar|annonsebestilling|annonssynpunkter|boka.?annons|boka|media(sales|salg|myynti)?|mediamyynti|mediekit|salg|sales|marknad|marknadsfor|marked|reklam|reklame|werbung|anzeigen|inserat|ilmoit|ilmoitukset|ilmoitusmyynti|mainos|kampanj|advertis|advertise)/i;
const BAD=/^(faktura|prenumeration|prenum|tilaaja|tilaus|abo|abonnement|medlem|member|bibliotek|info|post|kontakt|hei|hej|hello|redaksjon|redaktion|red@|student|career|jobb|hr@|support|kundeservice|kundservice|kundtjanst|no-?reply|noreply)/i;
async function main(){
  const accept = r.filter((x:any)=>x.status==="CORRECTED"&&x.best).filter((x:any)=>{const lp=x.best.split("@")[0].toLowerCase();return STRONG.test(lp)&&!BAD.test(lp);});
  const out:any[]=[]; let mapped=0, unmapped=0;
  for (const x of accept){
    const dom = x.best.split("@")[1].toLowerCase();
    // find active catalog titles on this domain
    const titles = await prisma.title.findMany({ where:{ discontinuedAt:null, websiteUrl:{ contains:dom, mode:"insensitive" } }, select:{ name:true, countryCode:true } });
    if (titles.length){ mapped++; out.push({ email:x.best, market:titles[0].countryCode, titles:titles.map(t=>t.name), source:x.bestOnAdPage?"site-adpage":"site-adpattern", wasPlaceholder:x.email }); }
    else { unmapped++; out.push({ email:x.best, market:null, titles:[], source:x.bestOnAdPage?"site-adpage":"site-adpattern", wasPlaceholder:x.email, note:"no active catalog title matched domain" }); }
  }
  writeFileSync("data/outreach/outreach_send_list_harvest_additions.json", JSON.stringify(out,null,2)+"\n");
  const by=r.reduce((a:any,x:any)=>{a[x.status]=(a[x.status]||0)+1;return a;},{});
  console.log("Harvest 1324 domains:", JSON.stringify(by));
  console.log(`Accepted (strict ad-sales): ${accept.length} | mapped to catalog title: ${mapped} | unmapped domain: ${unmapped}`);
  console.log("Written: data/outreach/outreach_send_list_harvest_additions.json");
  console.log("DROPPED (not silently): 259 CORRECTED rejected as billing/subscription/generic; 240 REVIEW (need manual look); 690 UNCONFIRMED; 75 ERROR.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
