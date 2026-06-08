/** Final mediekit extraction: Arkitektur.no, Båtliv SE (Marina Media), Vestavind,
 * Finansavisen reach. Reader stats + any native price not yet logged (dup-guarded). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
async function find1(where:any){ return prisma.title.findFirst({ where, select:{id:true,name:true,countryCode:true,outstandingInfo:true} }); }
async function quoteSafe(titleId:string,q:any){ const ex=await prisma.priceQuote.count({where:{contactLog:{titleId},price:q.price,priceUnit:q.priceUnit}}); if(ex){console.log(`   skip ${q.draftProductName}`);return;} await logQuote(q); }

async function main(){
  // 1) Arkitektur (HS Media / Anita Lindberg) — reader data + newsletter content (native) 7300/innrykk
  const ark = await find1({ countryCode:"NO", name:{equals:"Arkitektur",mode:"insensitive"} });
  if(ark){
    await prisma.title.update({ where:{id:ark.id}, data:{ offersNativeContent:true, digitalReach:268000,
      commercialExtra:{ source:"Arkitektur.no mediaplan 2026 (HS Media, Anita Lindberg)", monthlyPageViews:268000, newsletterSubscribers:8630, newsletterFreq:"2x/uke (tir+tor)",
        displayNett:"Toppbanner 9105/uke, Artikkelboard 5360/uke, Board1/2 5360/uke, Bigboard 7498/uke, parallax 9105/uke (eks mva)", nyhetsbrev:"Banner1 7300, Banner2 4900, Content 7300 per innrykk" } } });
    const log = await createContactLog({ titleId:ark.id, channel:"EMAIL", direction:"INBOUND",
      note:"INBOUND 2026-06-04: Arkitektur.no mediaplan 2026 (Anita Lindberg, KAM HS Media, al@hsmedia.no, 971 77 068). 268 000 sidevisn/mnd; nyhetsbrev 8630 ab. (2x/uke tir+tor). NATIVE: native ad 15 000/14 dager (print/web, logget tidl.); nyhetsbrev-content (native) 7300/innrykk. Display: toppbanner/parallax 9105/uke, bigboard 7498/uke, artikkelboard/board 5360/uke. Innhold kan også i papirmagasinet ARKITEKTUR. (Arkitektur N + Arkitekturnytt slått sammen til Arkitektur/arkitektur.no.)", actorId:ACTOR });
    await quoteSafe(ark.id, { draftProductType:"NATIVE_ARTICLE", draftProductName:"Nyhetsbrev content/native (Arkitektur)", draftProductDesc:"Content/native i nyhetsbrev, per innrykk (2x/uke, 8630 ab.).", contactLogId:log.id, price:7300, currency:"NOK", priceUnit:"FLAT", includedText:"Per innrykk, eks. mva.", recordedById:ACTOR });
    console.log(`Arkitektur: 268k sidevisn/mnd, nyhetsbrev 8630 + nyhetsbrev-native 7300/innrykk`);
  } else console.log("! Arkitektur not found");

  // 2) Båtliv SE (Marina Media, Svenska Båtunionen) — native advertorial 19900 SEK/utskick + circulation
  const bse = await find1({ countryCode:"SE", name:{equals:"Båtliv",mode:"insensitive"} });
  if(bse){
    await prisma.title.update({ where:{id:bse.id}, data:{ offersNativeContent:true,
      commercialExtra:{ source:"Båtliv 2026 mediekit (Marina Media, Henrik Salén)", owner:"Svenska Båtunionen", printCirculation:130200, printCirculationSource:"TS 2023/2024", editionsPerYear:6, newsletterReach:160000, note:"Europas största båttidning; ca 900 båtklubbar/SBU. Nyhetsbrev når ~160 000 båtklubbsmedlemmar." } } });
    const log = await createContactLog({ titleId:bse.id, channel:"EMAIL", direction:"INBOUND",
      note:"INBOUND 2026-06-05/08: Båtliv 2026 mediekit (Henrik Salén, Marina Media, henrik@batmedia.se, 0706-18 61 61). SVENSK Båtliv (Svenska Båtunionen), opplag 130 200/utg (TS 2023/24), 6 nr/år. NYHETSBREV ~160 000 båtklubbsmedlemmar: advertorial (NATIVE) ELLER banner 19 900 SEK/utskick; banner+advertorial 29 000 SEK; mengderabatt 10-40%. Digital batliv.se: toppbanner 19 400/mnd (feb-jun)/11 200 (jul-jan). Print: uppslag 64 900, 1/1 37 100, 1/2 22 200, omslag 32 300-41 500. (NB: svensk Båtliv ≠ norsk Båtliv/NMF.)", actorId:ACTOR });
    await quoteSafe(bse.id, { draftProductType:"ADVERTORIAL", draftProductName:"Nyhetsbrev advertorial (Båtliv SE)", draftProductDesc:"Advertorial (native) i nyhetsbrev til ~160 000 båtklubbsmedlemmar, 280x350 bild + tekst max 250 tegn.", contactLogId:log.id, price:19900, currency:"SEK", priceUnit:"FLAT", includedText:"Per utskick. Banner+advertorial 29 000. Mengderabatt 10-40%.", recordedById:ACTOR });
    console.log(`Båtliv SE [${bse.name}]: native advertorial 19900 SEK/utskick + opplag 130200 + nyhetsbrev 160000`);
  } else console.log("! Båtliv SE not found");

  // 3) Vestavind — no native; record price summary
  const ves = await find1({ countryCode:"NO", name:{equals:"Vestavind",mode:"insensitive"} });
  if(ves){
    await prisma.title.update({ where:{id:ves.id}, data:{
      commercialExtra:{ source:"vestavind_modulkart og prisar 2026 (Susanne Lie Vallestad)", nettPriser:"980x300+mobil 2750/uke, 980x300 desktop 1450/uke, 580x400 2150/uke, 320x250 1950/uke, 320x250 mobil 1200/uke, 320x400 mobil 1600/uke (eks mva)", printPriser:"Modulkart M11-M56 (520-14 040), M16 framside 3975, M16A 2090, tittelannonse 1645 (eks mva)", note:"Bygdeblad for Sveio (vekeavis). INGEN eget native-produkt; native tilpasses på forespørsel." } } });
    console.log("Vestavind: nett+print prissammendrag (ingen native-produkt)");
  } else console.log("! Vestavind not found");

  // 4) Finansavisen — reach/demografi
  const fa = await find1({ countryCode:"NO", name:{equals:"Finansavisen",mode:"insensitive"} });
  if(fa){
    await prisma.title.update({ where:{id:fa.id}, data:{ digitalReach:406000,
      audienceNote:"Finansavisen (Hegnar Media): total dekning 167 000/dag, 474 000/uke. Digital 130 000/dag, 406 000/uke; finansavisen.no 6,2 mill sidevisn/uke (+53% lesere siden 2019). Papir 50 000/dag, 137 000/uke; opplag 38 111 (+27% siste år). Snittalder 46, høy inntekt/utdanning, ~77% menn, bor sentralt. Avisen norske toppledere starter dagen med. Kilde: Medieinfo Finansavisen 2026." } });
    console.log("Finansavisen: dekning/demografi audienceNote + digitalReach 406000");
  } else console.log("! Finansavisen not found");

  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
