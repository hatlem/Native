/** Log a batch of outreach sends as ContactLog OUTBOUND per title, matching
 * the send-list group's title names to NO titles by exact (case-insensitive)
 * name. Bounced addresses get a BOUNCE-flagged note instead. Reports
 * matched/unmatched per group. */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const TODAY = "2026-06-08";

// 2026-06-08 SE batch: tailored Swedish price requests sent via Outlook (Admirate)
const DELIVERED = [
  "kundcenter@gotamedia.se", "ola.tallbom@vkmedia.se", "annons@hbl.fi",
  "mail@evagottfridsson.se", "redaktion@popularastronomi.se", "nils@res.se",
  "redaktion@cykelframjandet.se", "anders@sb-media.se", "sofie@joforlaget.se",
  "hej@slojdmagasinet.se",
];
// bounced (undeliverable, 550) — register so we know not to reuse + need correct contact
const BOUNCED: string[] = [];

async function logGroup(email: string, bounced: boolean) {
  const list: { email: string; market: string; titles: string[] }[] = JSON.parse(readFileSync("data/outreach/outreach_send_list.json", "utf8"));
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
    ? `BOUNCE ${TODAY}: e-post til ${email} ikke levert (Undeliverable – adressen finnes ikke). Trenger korrekt salgskontakt for denne utgiveren.`
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
