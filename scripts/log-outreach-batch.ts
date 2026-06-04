/** Log a batch of outreach sends as ContactLog OUTBOUND per title, matching
 * the send-list group's title names to NO titles by exact (case-insensitive)
 * name. Bounced addresses get a BOUNCE-flagged note instead. Reports
 * matched/unmatched per group. */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const TODAY = "2026-06-05";

// emails delivered today (cold outreach)
const DELIVERED = [
  "marked@amedia.no", "ann-elise.ertesvag@egmont.com", "annonser@bladet.no",
  "elin.ellingsen@schibsted.no", "knut@a2media.no", "markus@salgsfabrikken.no",
  "annonse@vl.no", "christian.lind@tunmedia.no",
];
// bounced (invalid address) — register so we know not to reuse
const BOUNCED = ["annonse@aller.no"];

async function logGroup(email: string, bounced: boolean) {
  const list: { email: string; market: string; titles: string[] }[] = JSON.parse(readFileSync("outreach_send_list.json", "utf8"));
  const group = list.find((g) => g.email.toLowerCase() === email.toLowerCase());
  if (!group) { console.log(`! ${email}: not in send list`); return; }
  // Match titles by exact name (case-insensitive) within the group's market.
  const titles = await prisma.title.findMany({
    where: { countryCode: group.market, name: { in: group.titles, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const matchedNames = new Set(titles.map((t) => t.name.toLowerCase()));
  const unmatched = group.titles.filter((n) => !matchedNames.has(n.toLowerCase()));
  const note = bounced
    ? `BOUNCE 2026-06-05: e-post til ${email} avvist (adressen finnes ikke – "user not found"). Trenger korrekt salgskontakt for denne utgiveren.`
    : `Sendt prisforespørsel (annonsørinnhold) via Outlook til ${email} – Andreas/Admirate, ${TODAY}.`;
  for (const t of titles) {
    await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "OUTBOUND", note, actorId: ACTOR });
  }
  console.log(`${bounced ? "BOUNCE" : "sent"} ${email}: logged ${titles.length}/${group.titles.length}${unmatched.length ? ` (unmatched: ${unmatched.slice(0, 6).join(", ")}${unmatched.length > 6 ? " …" : ""})` : ""}`);
}

async function main() {
  for (const e of DELIVERED) await logGroup(e, false);
  for (const e of BOUNCED) await logGroup(e, true);
  console.log("\nDone.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
