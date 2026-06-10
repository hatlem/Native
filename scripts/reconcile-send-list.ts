/** Rebuild the outreach send list as VERIFIED-ONLY (v2 — conservative).
 *
 * A group's LISTED contact email is CONFIRMED (kept) if ANY of:
 *   - harvester VERIFIED (exact address found live on its own domain)
 *   - a title in the group has an INBOUND reply (we're in conversation)
 *   - we already delivered to it before without a bounce
 * Otherwise we may CORRECT it with a SITE-CONFIRMED address:
 *   - harvester CORRECTED best address, or
 *   - an agent-found adEmail — but ONLY for small groups (<8 titles), so a
 *     single title's ad desk never hijacks a whole portfolio's sales contact.
 * Anything still unconfirmed -> QUARANTINE (never sent).
 * Discontinued titles are stripped; groups left with 0 active titles are dropped.
 * Writes data/outreach/outreach_send_list_verified.json + data/outreach/outreach_send_list_quarantine.json. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const PORTFOLIO_MIN = 8; // groups with >= this many titles: never override with a single-title adEmail
type G = { email: string; market: string; titles: string[] };
const groups: G[] = JSON.parse(readFileSync("data/outreach/outreach_send_list.json", "utf8"));
const harvest: { email: string; status: string; best: string | null }[] = JSON.parse(readFileSync("/tmp/email_verify.json", "utf8"));
const ademails: { email: string; adEmail: string | null; source: string | null }[] =
  existsSync("/tmp/all_ademails.json") ? JSON.parse(readFileSync("/tmp/all_ademails.json", "utf8")) : [];
const H = new Map(harvest.map((h) => [h.email.toLowerCase(), h]));
const A = new Map(ademails.filter((a) => a.adEmail).map((a) => [a.email.toLowerCase(), a]));
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s);

async function main() {
  const disc = await prisma.title.findMany({ where: { discontinuedAt: { not: null } }, select: { name: true, countryCode: true } });
  const discSet = new Set(disc.map((d) => d.countryCode + "|" + d.name.toLowerCase()));

  // titles we've had an INBOUND reply on -> their groups are "in conversation"
  const inbound = await prisma.contactLog.findMany({ where: { direction: "INBOUND", channel: "EMAIL" }, select: { title: { select: { name: true, countryCode: true } } } });
  const repliedTitles = new Set(inbound.map((l) => l.title && l.title.countryCode + "|" + l.title.name.toLowerCase()).filter(Boolean) as string[]);

  // emails we've sent to (OUTBOUND) and which of those bounced (from note text)
  const out = await prisma.contactLog.findMany({ where: { direction: "OUTBOUND", channel: "EMAIL" }, select: { note: true } });
  const delivered = new Set<string>(), bounced = new Set<string>();
  for (const l of out) {
    const note = l.note ?? "";
    const m = note.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    for (const e of m) (/(BOUNCE|ikke levert|avvist|couldn't be delivered)/i.test(note) ? bounced : delivered).add(e.toLowerCase());
  }

  const sendable: any[] = [], quarantine: any[] = [];
  let corrected = 0;
  for (const g of groups) {
    const em = g.email.toLowerCase();
    const titles = g.titles.filter((t) => !discSet.has(g.market + "|" + t.toLowerCase()));
    if (!titles.length) continue;
    const h = H.get(em), a = A.get(em);
    const isReplied = titles.some((t) => repliedTitles.has(g.market + "|" + t.toLowerCase()));
    const deliveredOk = delivered.has(em) && !bounced.has(em);
    const verifiedListed = (h && h.status === "VERIFIED") || isReplied || deliveredOk;

    let email: string | null = null, by = "";
    if (verifiedListed) { email = g.email; by = isReplied ? "reply" : deliveredOk ? "delivered" : "harvester"; }
    else if (a && a.adEmail && isEmail(a.adEmail) && titles.length < PORTFOLIO_MIN) { email = a.adEmail; by = "site"; }
    else if (h && h.status === "CORRECTED" && h.best && isEmail(h.best)) { email = h.best; by = "harvester-corrected"; }

    if (email) {
      if (email.toLowerCase() !== em) corrected++;
      sendable.push({ email, market: g.market, titles, wasEmail: email.toLowerCase() !== em ? g.email : undefined, verifiedBy: by });
    } else {
      quarantine.push({ email: g.email, market: g.market, titles, harvester: h && h.status || "UNKNOWN" });
    }
  }
  writeFileSync("data/outreach/outreach_send_list_verified.json", JSON.stringify(sendable, null, 2) + "\n");
  writeFileSync("data/outreach/outreach_send_list_quarantine.json", JSON.stringify(quarantine, null, 2) + "\n");
  const summary = {
    inputGroups: groups.length, sendable: sendable.length, quarantined: quarantine.length,
    droppedEmptyGroups: groups.length - sendable.length - quarantine.length,
    emailsCorrected: corrected, sendableTitles: sendable.reduce((a, g) => a + g.titles.length, 0),
    sendableBy: sendable.reduce((a: any, g) => { a[g.verifiedBy] = (a[g.verifiedBy] || 0) + 1; return a; }, {}),
  };
  writeFileSync("/tmp/reconcile_summary.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
