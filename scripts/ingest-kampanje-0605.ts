import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
async function main() {
  const ts = await prisma.title.findMany({ where:{ countryCode:"NO", name:{ in:["Kampanje","Markedsføring","Markedsforing"] } }, select:{id:true,name:true,outstandingInfo:true} });
  const note = "INBOUND 2026-06-05 12:58: Nina Gade Tenvik (Kampanje, nina.tenvik@kampanje.com). Tilbyr Branded Content: enkeltstående native-artikler, native, eller 4-artikler-pakke (Branded Stories). Priser på produktside (kampanje.com), ikke i e-post; bannere = display (utenfor scope). Trenger uker/antall uker/flater/budsjett for pakketilbud. Svart med budsjett-rammeverk + bedt om omtrentlig pris per native-artikkel + 4-pakke. AVVENTER indikativ native-pris.";
  for (const t of ts) {
    await createContactLog({ titleId:t.id, channel:"EMAIL", direction:"INBOUND", note, actorId:ACTOR });
    await prisma.title.update({ where:{ id:t.id }, data:{
      offersNativeContent:true, verificationStatus:"LIVE", verificationSource:"Kampanje (Nina Gade Tenvik) 2026-06-05; kampanje.com",
      outstandingInfo:{ set:[...new Set([...(t.outstandingInfo??[]), "Indikativ native-/Branded Content-pris avventer (Kampanje 2026-06-05)"])] },
    } });
  }
  console.log("Nina/Kampanje logget på:", ts.map(t=>t.name).join(", ") || "(ingen treff)");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
