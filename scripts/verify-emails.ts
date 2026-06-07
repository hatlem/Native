/** Deterministic email verifier for the outreach send list.
 * For each group, fetch the contact address's OWN domain (homepage + common
 * advertising/contact pages + any mailto links found) and extract real emails
 * from raw HTML (no redaction). Then classify the group's address:
 *   VERIFIED  – exact address appears on its own domain
 *   CORRECTED – address absent, but a clear ad-sales email found on the domain
 *   UNCONFIRMED – domain unreachable, or no ad email in raw HTML (e.g. JS-rendered)
 * Output: /tmp/email_verify.json  (array of {email, market, status, found, best})
 * Read-only over the network; writes nothing to the DB. */
import { readFileSync, writeFileSync } from "node:fs";

type Group = { email: string; market: string; titles: string[]; urls: string[] };
const groups: Group[] = JSON.parse(readFileSync("/tmp/verify_input.json", "utf8"));

const PATHS = ["", "/annonsera", "/annonsera/", "/annons", "/annonser", "/boka-annons",
  "/boka", "/kundservice/annonsera", "/kontakt", "/kontakta-oss", "/kontakt-oss",
  "/annoncer", "/annoncering", "/advertise", "/advertising", "/mediekit", "/mediakit",
  "/om-oss/kontakt", "/for-annonsorer", "/annonsering"];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const AD_HINT = /(annons|annonc|advertis|boka|sales|salg|marknad|marked|mediekit|mediakit|kampanj|reklam)/i;
const BAD_LOCAL = /^(no-?reply|noreply|postmaster|abuse|webmaster|gdpr|dataskydd|personuppgift)/i;

const TIMEOUT = 7000;
async function get(url: string): Promise<string | null> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), TIMEOUT);
    const r = await fetch(url, { signal: c.signal, redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 NativeSpinVerify/1.0" } });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

function emailsFrom(html: string, domain: string): string[] {
  const set = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) set.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of html.match(EMAIL_RE) || []) set.add(m.toLowerCase());
  // keep only addresses on the contact domain (or its parent), drop image-ish noise
  return [...set].filter((e) => e.includes("@" + domain) || e.endsWith("." + domain) || e.split("@")[1] === domain);
}

async function verifyDomain(domain: string): Promise<string[]> {
  const found = new Set<string>();
  const base = "https://" + domain;
  const home = await get(base);
  const toFetch = new Set<string>(PATHS.map((p) => base + p));
  if (home) {
    for (const e of emailsFrom(home, domain)) found.add(e);
    // follow up to 4 ad/contact links from the homepage
    let n = 0;
    for (const m of home.matchAll(/href=["']([^"']+)["']/gi)) {
      if (n >= 4) break;
      const href = m[1];
      if (AD_HINT.test(href) || /kontakt|contact/i.test(href)) {
        try { toFetch.add(new URL(href, base).href); n++; } catch { /* skip */ }
      }
    }
  }
  for (const u of toFetch) {
    const html = await get(u);
    if (html) for (const e of emailsFrom(html, domain)) found.add(e);
  }
  return [...found].filter((e) => !BAD_LOCAL.test(e.split("@")[0]));
}

function scoreAd(email: string): number {
  const local = email.split("@")[0];
  if (/^(annons|annonse|annonser|boka.?annons|boka)/.test(local)) return 5;
  if (AD_HINT.test(local)) return 4;
  if (/^(salg|sales|marked|marknad|media|mediekit)/.test(local)) return 4;
  if (/^(post|kontakt|kundservice|info|hello|hei|hej)/.test(local)) return 2;
  return 1;
}

async function main() {
  const domains = new Map<string, string[]>(); // emailDomain -> found emails (cached)
  const results: any[] = [];
  const concurrency = 10;
  let idx = 0;
  async function worker() {
    while (idx < groups.length) {
      const g = groups[idx++];
      const dom = g.email.split("@")[1].toLowerCase();
      if (!domains.has(dom)) domains.set(dom, await verifyDomain(dom));
      const found = domains.get(dom)!;
      const exact = found.includes(g.email.toLowerCase());
      const ad = [...found].sort((a, b) => scoreAd(b) - scoreAd(a));
      const best = ad[0] || null;
      const status = exact ? "VERIFIED"
        : best && scoreAd(best) >= 4 ? "CORRECTED"
        : found.length ? "REVIEW" : "UNCONFIRMED";
      results.push({ email: g.email, market: g.market, titles: g.titles.length, status,
        best: status === "CORRECTED" ? best : null, found });
      if (results.length % 50 === 0) console.error(`...${results.length}/${groups.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  writeFileSync("/tmp/email_verify.json", JSON.stringify(results, null, 1));
  const by = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {} as any);
  console.log("DONE. status counts:", JSON.stringify(by));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
