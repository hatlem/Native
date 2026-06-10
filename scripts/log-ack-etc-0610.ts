import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
const ACTOR="cmpmdiqtg048c0hu080m8kmok"; const TAG="reply-ack 2026-06-10 (ETC)";
async function main(){
 const t=await prisma.title.findFirst({where:{slug:"dagens-etc-se"},select:{id:true}});
 if(t && (await prisma.contactLog.count({where:{titleId:t.id,direction:"OUTBOUND",note:{contains:TAG}}}))===0){
  await createContactLog({titleId:t.id,channel:"EMAIL",direction:"OUTBOUND",note:"OUTBOUND 2026-06-10 (→ jim.berg@etc.se): Ack — noterar native-artikel 30 000 ex moms (puff ettan 100k/v i 3v) för budgeten; konkret efter sommaren. "+TAG,actorId:ACTOR});
  console.log("Dagens ETC: OUTBOUND ack logged");
 } else console.log("already/missing");
 await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
