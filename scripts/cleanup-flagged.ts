/** Clean up flagged data problems surfaced by the Rytter + TU Media replies.
 * Only verifiable fixes — no guessing of unknown URLs/publishers. */
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const TU = "cmpmdiqaa02740hu0wmaem2bd";      // url www.tu.no, misnamed "Teknologi & Verkstedindustri"
const HEST_OG_HOVER = "cmpmdiq9z01r10hu06nxadqsw"; // wrong url rytter.no, not NRyF
const NORSK_RIDESPORT = "cmpmdiqaa027d0hu0bhl3y5cy"; // wrong url rytter.no, not NRyF

async function freeSlug(base: string): Promise<string> {
  let slug = base, n = 2;
  while (await prisma.title.findFirst({ where: { slug } })) slug = `${base}-${n++}`;
  return slug;
}

async function main() {
  // 1) tu.no → correct name (TU Media confirmed TU.no is theirs).
  const tu = await prisma.title.findUniqueOrThrow({ where: { id: TU }, select: { name: true, slug: true } });
  const newSlug = tu.slug === "tu-no" ? tu.slug : await freeSlug("tu-no");
  await prisma.title.update({ where: { id: TU }, data: { name: "TU.no", slug: newSlug } });
  console.log(`Renamed "${tu.name}" → "TU.no" (slug ${newSlug})`);

  // 2) Hest og Høver: fix spelling, clear wrong rytter.no url, drop the
  //    misattributed outreach log (nryf@rytter.no wasn't its contact).
  const hh = await prisma.contactLog.deleteMany({ where: { titleId: HEST_OG_HOVER } });
  await prisma.title.update({ where: { id: HEST_OG_HOVER }, data: { name: "Hest og Høver", websiteUrl: null, lastVerifiedAt: null } });
  console.log(`Hest og Høver: fixed name, cleared wrong url, removed ${hh.count} misattributed log(s)`);

  // 3) Norsk Ridesport: clear wrong rytter.no url, drop misattributed log.
  const nr = await prisma.contactLog.deleteMany({ where: { titleId: NORSK_RIDESPORT } });
  await prisma.title.update({ where: { id: NORSK_RIDESPORT }, data: { websiteUrl: null, lastVerifiedAt: null } });
  console.log(`Norsk Ridesport: cleared wrong url, removed ${nr.count} misattributed log(s)`);

  await recordAudit(ACTOR, "title.cleanup", "Title:flagged-rytter-tu", { tu: "renamed TU.no", hestOgHover: "url cleared", norskRidesport: "url cleared" });
  console.log("\nDone. NB: korrekt utgiver/URL for Hest og Høver + Norsk Ridesport er fortsatt uverifisert (ikke NRyF per Pia).");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
