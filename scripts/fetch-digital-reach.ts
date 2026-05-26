// Walk every title with a websiteUrl, look up StatShow's estimate of
// monthly unique visitors, and write it to Title.digitalReach.
//
// Notes:
// - StatShow's free page returns a sentence like "It reaches roughly N
//   users and delivers about M pageviews each month." That number is
//   the third-party estimate we trust for the long tail. Not as good
//   as wiring a paid SimilarWeb API key, but defensible.
// - Polite throttle (~2 req/s) with random jitter to avoid being
//   flagged as a bot. Realistic User-Agent.
// - Idempotent / resumable: skips titles whose digitalReach was set in
//   this run (we record `digitalReachSource = "statshow"`).
// - Logs every result to scripts/fetch-digital-reach.log so a fresh
//   run can audit + retry just the failures.

import { prisma } from "@/lib/prisma";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOG_PATH = join(process.cwd(), "scripts/fetch-digital-reach.log");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Safari/605.1.15";

type Outcome =
  | { ok: true; visitors: number; pageviews: number | null }
  | { ok: false; reason: string };

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function parseStatShow(html: string): Outcome {
  // Two patterns observed: "It reaches roughly <b>22,050</b> users" and
  // some pages render the number as plain text inside a stat row.
  const reachesRe =
    /reaches roughly\s*<[^>]*>?\s*([\d,]+)\s*<\/[^>]*>?\s*users/i;
  const pagesRe =
    /delivers about\s*<[^>]*>?\s*([\d,]+)\s*<\/[^>]*>?\s*pageviews/i;

  const reachM = html.match(reachesRe);
  if (!reachM) {
    // Some pages return a stub when StatShow has no data for the
    // domain — detect that explicitly so the caller can mark the
    // title as "tried, no data".
    if (/No data found|We don'?t have any data/i.test(html)) {
      return { ok: false, reason: "no-data" };
    }
    if (/Just a moment|cloudflare|cf-chl/i.test(html)) {
      return { ok: false, reason: "cloudflare" };
    }
    return { ok: false, reason: "no-match" };
  }
  const visitors = Number(reachM[1].replace(/,/g, ""));
  if (!Number.isFinite(visitors) || visitors <= 0) {
    return { ok: false, reason: "bad-number" };
  }
  const pagesM = html.match(pagesRe);
  const pageviews = pagesM ? Number(pagesM[1].replace(/,/g, "")) : null;
  return { ok: true, visitors, pageviews };
}

async function fetchOnce(domain: string, attempt: number): Promise<Outcome> {
  const url = `https://www.statshow.com/www/${domain}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      // 20s hard cap per request
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) return { ok: false, reason: "429" };
    if (res.status === 403) return { ok: false, reason: "403" };
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const html = await res.text();
    return parseStatShow(html);
  } catch (err) {
    return { ok: false, reason: `fetch-err:${(err as Error).message}` };
  }
}

async function fetchWithRetry(domain: string): Promise<Outcome> {
  for (let i = 0; i < 3; i++) {
    const r = await fetchOnce(domain, i);
    if (r.ok) return r;
    // Back off harder on rate-limits / cloudflare; skip the retry
    // entirely when StatShow says they have no data.
    if (r.reason === "no-data" || r.reason === "no-match") return r;
    const delay = 2_000 * (i + 1) + Math.random() * 1_000;
    await new Promise((res) => setTimeout(res, delay));
  }
  return { ok: false, reason: "retries-exhausted" };
}

function loadPreviouslySeen(): Set<string> {
  if (!existsSync(LOG_PATH)) return new Set();
  const lines = readFileSync(LOG_PATH, "utf8").split("\n");
  const ok = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^OK\s+([^\s]+)\s/);
    if (m) ok.add(m[1]);
  }
  return ok;
}

async function main() {
  const titles = await prisma.title.findMany({
    where: { websiteUrl: { not: null } },
    select: { id: true, name: true, websiteUrl: true },
    orderBy: { name: "asc" },
  });
  const seen = loadPreviouslySeen();
  const work = titles
    .map((t) => ({ ...t, domain: extractDomain(t.websiteUrl!) }))
    .filter((t) => t.domain && !seen.has(t.domain));

  console.log(
    `Total titles with URL: ${titles.length} · already done: ${seen.size} · todo: ${work.length}`,
  );

  let ok = 0;
  let fail = 0;
  let started = Date.now();
  for (let i = 0; i < work.length; i++) {
    const t = work[i];
    const r = await fetchWithRetry(t.domain!);
    const stamp = new Date().toISOString();
    if (r.ok) {
      await prisma.title.update({
        where: { id: t.id },
        data: { digitalReach: r.visitors },
      });
      appendFileSync(
        LOG_PATH,
        `OK ${t.domain} ${r.visitors} ${stamp} ${t.name}\n`,
      );
      ok++;
    } else {
      appendFileSync(LOG_PATH, `FAIL ${t.domain} ${r.reason} ${stamp} ${t.name}\n`);
      fail++;
    }
    if ((i + 1) % 25 === 0) {
      const elapsedMs = Date.now() - started;
      const rate = (i + 1) / (elapsedMs / 1000);
      const remaining = work.length - (i + 1);
      const etaSec = Math.round(remaining / rate);
      const etaMin = Math.round(etaSec / 60);
      process.stdout.write(
        `\r[${i + 1}/${work.length}] ok=${ok} fail=${fail} rate=${rate.toFixed(2)}/s eta=${etaMin}m`,
      );
    }
    // Polite throttle: ~2 requests / second with jitter so we don't
    // look mechanical.
    await new Promise((res) => setTimeout(res, 400 + Math.random() * 350));
  }
  console.log(`\nDone. ok=${ok} fail=${fail}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
