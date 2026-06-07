/* Browser (JS-rendered) email verifier for quarantined groups.
 * Renders each contact-email's OWN domain + common advertising/contact pages in
 * headless Chrome, then extracts emails that are literally published on that
 * domain. No guessing — only addresses present on the publisher's own site.
 *   VERIFIED  : the listed address itself appears on its domain
 *   CORRECTED : listed absent, but an ad/sales email is published (best scored),
 *               with the page it was found on (advertising pages = high trust)
 *   UNCONFIRMED: nothing published / unreachable
 * Output: /tmp/chrome_verify.json
 */
const fs = require("fs");
const { chromium } = require("playwright-core");

const groups = JSON.parse(fs.readFileSync("/tmp/quarantine_in.json", "utf8"));
const PATHS = ["", "/annonsera", "/annonsera/", "/annons", "/annonser", "/annonsering",
  "/boka-annons", "/boka", "/kundservice/annonsera", "/kontakt", "/kontakta-oss",
  "/kontakt-oss", "/kontakta", "/annoncer", "/annoncering", "/advertise",
  "/advertising", "/advertise-with-us", "/mediekit", "/mediakit", "/media-kit",
  "/for-annonsorer", "/om-oss/kontakt", "/yhteystiedot", "/ilmoittajalle", "/mediatiedot"];
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const AD_PAGE = /(annons|annonc|advertis|boka|mediekit|mediakit|mediatiedot|ilmoit|reklam|kontakt|contact|yhteys)/i;
const BAD = /^(no-?reply|noreply|postmaster|abuse|webmaster|gdpr|dataskydd|personuppgift|privacy|unsubscribe|example)/i;
const scoreAd = (e) => { const l = e.split("@")[0].toLowerCase();
  if (/^(annons|annonse|annonser|annonsera|boka.?annons|boka|annoncer|ilmoit|mediamyynti)/.test(l)) return 5;
  if (AD_PAGE.test(l) || /^(sales|salg|marknad|marked|media|mediekit)/.test(l)) return 4;
  if (/^(post|kontakt|kundservice|info|hej|hei|hello|yhteys)/.test(l)) return 2; return 1; };

function pick(found, domain) {
  const onDomain = found.filter((f) => { const d = f.email.split("@")[1]; return d === domain || d.endsWith("." + domain) || domain.endsWith("." + d); });
  const ok = onDomain.filter((f) => !BAD.test(f.email.split("@")[0]));
  ok.sort((a, b) => (b.adPage - a.adPage) || (scoreAd(b.email) - scoreAd(a.email)));
  return ok;
}

async function verifyDomain(browser, domain) {
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 NativeSpinVerify/1.0", ignoreHTTPSErrors: true });
  const found = []; const seen = new Set();
  const base = "https://" + domain;
  const toVisit = PATHS.map((p) => base + p);
  let extraLinks = [];
  for (const url of toVisit.concat(extraLinks)) {
    if (seen.size > 60) break;
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 9000 });
      if (!resp) { await page.close(); continue; }
      await page.waitForTimeout(600);
      const data = await page.evaluate(() => {
        const mailtos = [...document.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute("href").slice(7).split("?")[0]);
        return { mailtos, text: document.body ? document.body.innerText : "", html: document.documentElement.innerHTML.slice(0, 400000) };
      });
      const adPage = AD_PAGE.test(url) ? 1 : 0;
      const emails = new Set([...data.mailtos.map((m) => decodeURIComponent(m)), ...(data.text.match(EMAIL_RE) || []), ...(data.html.match(EMAIL_RE) || [])]);
      for (const e of emails) { const el = e.toLowerCase().trim(); if (!seen.has(el)) { seen.add(el); found.push({ email: el, adPage }); } }
      // on homepage, queue a few ad/contact links
      if (url === base) {
        const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.href).slice(0, 400));
        extraLinks = links.filter((h) => AD_PAGE.test(h)).slice(0, 6);
        toVisit.push(...extraLinks);
      }
    } catch { /* unreachable page */ } finally { await page.close(); }
  }
  await ctx.close();
  return pick(found, domain);
}

async function main() {
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  const results = []; let i = 0; const CONC = 5;
  const domains = new Map();
  async function worker(wid) {
    while (i < groups.length) {
      const g = groups[i++];
      const dom = g.email.split("@")[1].toLowerCase();
      try {
        if (!domains.has(dom)) domains.set(dom, await verifyDomain(browser, dom));
        const ok = domains.get(dom);
        const exact = ok.find((f) => f.email === g.email.toLowerCase());
        const best = ok[0] || null;
        const status = exact ? "VERIFIED"
          : best && (best.adPage || scoreAd(best.email) >= 4) ? "CORRECTED"
          : best ? "REVIEW" : "UNCONFIRMED";
        results.push({ email: g.email, market: g.market, titles: g.titles.length, status,
          best: status === "CORRECTED" ? best.email : null, bestOnAdPage: best ? !!best.adPage : false,
          found: ok.slice(0, 6).map((f) => f.email) });
      } catch (e) { results.push({ email: g.email, market: g.market, status: "ERROR", err: String(e).slice(0, 80) }); }
      if (results.length % 20 === 0) console.error(`...${results.length}/${groups.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, (_, k) => worker(k)));
  await browser.close();
  fs.writeFileSync("/tmp/chrome_verify.json", JSON.stringify(results, null, 1));
  const by = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log("DONE:", JSON.stringify(by));
}
main().catch((e) => { console.error(e); process.exit(1); });
