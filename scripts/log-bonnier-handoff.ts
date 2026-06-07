/** Log the INBOUND reply from Filippa Wijkström (Bonnier News SE) as a
 * ContactLog on the Bonnier News SE titles. No prices yet — she cc'd in
 * Johan Petersen (johan.petersen@bonniernews.se) who takes it further, so
 * this is a handoff event (no PriceQuote). Matches the send-list group's
 * titles by exact name within market SE. */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const GROUP_EMAIL = "filippa.wijkstrom@bonniernews.se";
const NOTE =
  "INBOUND 2026-06-04: Filippa Wijkström (Head of Sales, Bonnier News) svarte på prisforespørselen og cc-et inn kollega Johan Petersen (johan.petersen@bonniernews.se) som tar saken videre. Ingen priser ennå – avventer prisoversikt for native/annonsørinnhold. Svart med kort takk/oppfølging.";

async function main() {
  const list: { email: string; market: string; titles: string[] }[] = JSON.parse(
    readFileSync("outreach_send_list.json", "utf8"),
  );
  const group = list.find((g) => g.email.toLowerCase() === GROUP_EMAIL.toLowerCase());
  if (!group) throw new Error(`group ${GROUP_EMAIL} not in send list`);
  const titles = await prisma.title.findMany({
    where: { countryCode: group.market, name: { in: group.titles, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const matched = new Set(titles.map((t) => t.name.toLowerCase()));
  const unmatched = group.titles.filter((n) => !matched.has(n.toLowerCase()));
  for (const t of titles) {
    await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: NOTE, actorId: ACTOR });
  }
  console.log(`logged INBOUND on ${titles.length}/${group.titles.length} Bonnier News SE titles`);
  if (unmatched.length) console.log(`unmatched (${unmatched.length}): ${unmatched.join(", ")}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
