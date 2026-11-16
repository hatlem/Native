#!/usr/bin/env node
// Load test for NativeSpin — plain Node (fetch + async workers), no
// dependencies. See docs/testing/load-test.md.
//
//   node scripts/loadtest/run.mjs                       # local app on :3000
//   LOADTEST_BASE_URL=https://staging.example LOADTEST_ALLOW_REMOTE=1 \
//   LOADTEST_EMAIL=… LOADTEST_PASSWORD=… LOADTEST_API_KEY=… \
//   LOADTEST_STAGES=10:30,25:60,50:60 node scripts/loadtest/run.mjs
//
// It ramps through stages of N concurrent virtual users. Each user loops
// over a weighted mix of real pages: the public catalog and search, a title
// page, the signed-in buyer pages, the v1 catalog API and the health check.
// It only reads — no request, order or email is ever created.
import { writeFileSync } from "node:fs";

const env = process.env;
const BASE = (env.LOADTEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const LOCALE = env.LOADTEST_LOCALE || "en";
const STAGES = (env.LOADTEST_STAGES || "5:15,15:30,30:30").split(",").map((s) => {
  const [users, seconds] = s.split(":").map(Number);
  if (!(users > 0) || !(seconds > 0)) throw new Error(`bad stage "${s}" — use users:seconds, e.g. 10:30`);
  return { users, seconds };
});
const TIMEOUT_MS = Number(env.LOADTEST_TIMEOUT_MS || 30_000);
const THINK_MS = Number(env.LOADTEST_THINK_MS || 0);
// Optional pass/fail thresholds; when set, a breach exits 1.
const P95_LIMIT = env.LOADTEST_P95_MS ? Number(env.LOADTEST_P95_MS) : null;
const ERROR_LIMIT = env.LOADTEST_MAX_ERROR_RATE ? Number(env.LOADTEST_MAX_ERROR_RATE) : null;
const OUT = env.LOADTEST_OUT || "";

// ---- Safety rail -----------------------------------------------------------
const host = new URL(BASE).hostname;
const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(host) || host.endsWith(".localhost");
if (!isLocal && env.LOADTEST_ALLOW_REMOTE !== "1") {
  console.error(
    `Refusing to load-test ${host}: it is not a local address.\n` +
      "Point LOADTEST_BASE_URL at staging and set LOADTEST_ALLOW_REMOTE=1 to confirm.\n" +
      "Never run this against production.",
  );
  process.exit(2);
}

// ---- HTTP ------------------------------------------------------------------
async function timed(name, path, { headers = {}, expect = [200] } = {}) {
  const started = performance.now();
  let status = 0;
  let bytes = 0;
  let error = "";
  try {
    const res = await fetch(BASE + path, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    status = res.status;
    bytes = (await res.arrayBuffer()).byteLength;
  } catch (err) {
    error = err?.name === "TimeoutError" ? "timeout" : String(err?.cause?.code || err?.message || err);
  }
  const ms = performance.now() - started;
  record(name, { ms, status, bytes, error, ok: !error && expect.includes(status), throttled: status === 429 });
}

// ---- Session (optional) ----------------------------------------------------
// Auth.js credentials sign-in without a browser: CSRF token, then the
// callback. Accounts with two-factor cannot sign in this way — use a test
// account without it, or pass LOADTEST_COOKIE.
async function signIn(email, password) {
  const jar = new Map();
  const absorb = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  absorb(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie(), "x-auth-return-redirect": "1" },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${BASE}/${LOCALE}/home` }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  absorb(res);
  const session = [...jar.keys()].find((k) => k.endsWith("authjs.session-token"));
  if (!session) throw new Error(`sign-in as ${email} issued no session (wrong password, unverified, or two-factor is on)`);
  return cookie();
}

// ---- Stats -----------------------------------------------------------------
const stats = new Map();
let stageIndex = 0;
function record(name, sample) {
  let s = stats.get(name);
  if (!s) stats.set(name, (s = { name, samples: [], errors: 0, throttled: 0, statuses: {}, bytes: 0, byStage: STAGES.map(() => []) }));
  s.samples.push(sample.ms);
  s.byStage[stageIndex].push(sample.ms);
  s.bytes += sample.bytes;
  const key = sample.error || String(sample.status);
  s.statuses[key] = (s.statuses[key] || 0) + 1;
  if (sample.throttled) s.throttled++;
  else if (!sample.ok) s.errors++;
}
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
function summarise(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: Math.round(pct(sorted, 50)),
    p95: Math.round(pct(sorted, 95)),
    p99: Math.round(pct(sorted, 99)),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
  };
}

// ---- Scenario --------------------------------------------------------------
async function discover() {
  const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((e) => e);
  if (!(res instanceof Response) || res.status !== 200) throw new Error(`${BASE}/api/health is not healthy — is the app running?`);
  let slugs = (env.LOADTEST_TITLE_SLUGS || "").split(",").filter(Boolean);
  let cookie = env.LOADTEST_COOKIE || "";
  if (!cookie && env.LOADTEST_EMAIL && env.LOADTEST_PASSWORD) cookie = await signIn(env.LOADTEST_EMAIL, env.LOADTEST_PASSWORD);
  if (slugs.length === 0) {
    // Title links from the catalog itself (the signed-in catalog lists them).
    const html = await (await fetch(`${BASE}/${LOCALE}/catalog`, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(TIMEOUT_MS) })).text();
    slugs = [...new Set([...html.matchAll(new RegExp(`/${LOCALE}/catalog/([a-z0-9][a-z0-9-]+)["?]`, "g"))].map((m) => m[1]))].filter((s) => s !== "compare").slice(0, 12);
  }
  return { slugs, cookie, apiKey: env.LOADTEST_API_KEY || "" };
}

const SEARCH_TERMS = ["avis", "finans", "sport", "tech", "helse", "oslo", "business", "mat"];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function buildMix({ slugs, cookie, apiKey }) {
  const auth = { cookie };
  const mix = [
    { weight: 2, run: () => timed("GET /api/health", "/api/health") },
    { weight: 6, run: () => timed("public catalog", `/${LOCALE}/catalog`) },
    { weight: 4, run: () => timed("public landing", `/${LOCALE}`) },
    { weight: 4, run: () => timed("public catalog search", `/${LOCALE}/catalog?q=${pick(SEARCH_TERMS)}`) },
  ];
  if (slugs.length) mix.push({ weight: 6, run: () => timed("title page", `/${LOCALE}/catalog/${pick(slugs)}`, { headers: cookie ? auth : {} }) });
  if (cookie) {
    mix.push(
      { weight: 6, run: () => timed("buyer catalog", `/${LOCALE}/catalog`, { headers: auth }) },
      { weight: 4, run: () => timed("buyer catalog search", `/${LOCALE}/catalog?q=${pick(SEARCH_TERMS)}`, { headers: auth }) },
      { weight: 3, run: () => timed("buyer home", `/${LOCALE}/home`, { headers: auth }) },
      { weight: 3, run: () => timed("buyer requests", `/${LOCALE}/requests`, { headers: auth }) },
      { weight: 2, run: () => timed("buyer plan", `/${LOCALE}/plan`, { headers: auth, expect: [200, 307] }) },
      { weight: 2, run: () => timed("buyer invoices", `/${LOCALE}/invoices`, { headers: auth }) },
    );
  }
  if (apiKey) {
    const headers = { authorization: `Bearer ${apiKey}` };
    mix.push(
      { weight: 4, run: () => timed("api v1 titles", "/api/v1/catalog/titles?limit=50", { headers }) },
      { weight: 2, run: () => timed("api v1 titles (market)", "/api/v1/catalog/titles?limit=50&market=NO", { headers }) },
    );
  }
  const bag = mix.flatMap((m) => Array(m.weight).fill(m.run));
  return () => pick(bag)();
}

async function main() {
  const ctx = await discover();
  const step = buildMix(ctx);
  console.log(`Load test → ${BASE}`);
  console.log(`  signed-in pages: ${ctx.cookie ? "yes" : "no (set LOADTEST_EMAIL + LOADTEST_PASSWORD)"}`);
  console.log(`  v1 API:          ${ctx.apiKey ? "yes" : "no (set LOADTEST_API_KEY)"}`);
  console.log(`  title pages:     ${ctx.slugs.length}`);
  console.log(`  stages:          ${STAGES.map((s) => `${s.users} users × ${s.seconds}s`).join(" → ")}\n`);

  const stageResults = [];
  for (stageIndex = 0; stageIndex < STAGES.length; stageIndex++) {
    const { users, seconds } = STAGES[stageIndex];
    const until = Date.now() + seconds * 1000;
    const before = [...stats.values()].reduce((n, s) => n + s.samples.length, 0);
    const errorsBefore = [...stats.values()].reduce((n, s) => n + s.errors, 0);
    await Promise.all(
      Array.from({ length: users }, async () => {
        while (Date.now() < until) {
          await step();
          if (THINK_MS) await new Promise((r) => setTimeout(r, THINK_MS));
        }
      }),
    );
    const all = [...stats.values()].flatMap((s) => s.byStage[stageIndex]);
    const done = [...stats.values()].reduce((n, s) => n + s.samples.length, 0) - before;
    const errors = [...stats.values()].reduce((n, s) => n + s.errors, 0) - errorsBefore;
    const r = { users, seconds, requests: done, rps: +(done / seconds).toFixed(1), errors, ...summarise(all) };
    stageResults.push(r);
    console.log(`stage ${stageIndex + 1}: ${users} users  ${r.rps} req/s  p50 ${r.p50}ms  p95 ${r.p95}ms  p99 ${r.p99}ms  errors ${errors}`);
  }

  const endpoints = [...stats.values()]
    .map((s) => ({
      name: s.name,
      ...summarise(s.samples),
      errors: s.errors,
      errorRate: +(s.errors / s.samples.length).toFixed(4),
      throttled: s.throttled,
      avgKb: +(s.bytes / s.samples.length / 1024).toFixed(1),
      statuses: s.statuses,
      p95ByStage: s.byStage.map((b) => summarise(b).p95),
    }))
    .sort((a, b) => b.p95 - a.p95);

  const pad = (v, n) => String(v).padEnd(n);
  const num = (v, n = 7) => String(v).padStart(n);
  console.log(`\n${pad("endpoint (slowest first)", 26)}${num("count")}${num("p50")}${num("p95")}${num("p99")}${num("max")}${num("err%")}${num("429")}${num("KB")}   p95 per stage`);
  for (const e of endpoints) {
    console.log(`${pad(e.name, 26)}${num(e.count)}${num(e.p50)}${num(e.p95)}${num(e.p99)}${num(e.max)}${num((e.errorRate * 100).toFixed(1))}${num(e.throttled)}${num(e.avgKb)}   ${e.p95ByStage.join(" → ")}`);
  }
  const total = endpoints.reduce((n, e) => n + e.count, 0);
  const totalErrors = endpoints.reduce((n, e) => n + e.errors, 0);
  const errorRate = total ? totalErrors / total : 0;
  const worstP95 = endpoints[0]?.p95 ?? 0;
  console.log(`\ntotal ${total} requests, ${totalErrors} errors (${(errorRate * 100).toFixed(2)}%), slowest p95 ${worstP95}ms (${endpoints[0]?.name})`);
  for (const e of endpoints.filter((e) => e.errors)) console.log(`  errors on ${e.name}: ${JSON.stringify(e.statuses)}`);

  const breaches = [];
  if (P95_LIMIT !== null) for (const e of endpoints) if (e.p95 > P95_LIMIT) breaches.push(`${e.name}: p95 ${e.p95}ms > ${P95_LIMIT}ms`);
  if (ERROR_LIMIT !== null && errorRate > ERROR_LIMIT) breaches.push(`error rate ${(errorRate * 100).toFixed(2)}% > ${(ERROR_LIMIT * 100).toFixed(2)}%`);
  const report = { base: BASE, at: new Date().toISOString(), stages: stageResults, endpoints, total, totalErrors, errorRate, breaches };
  if (OUT) {
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`\nJSON report written to ${OUT}`);
  }
  if (breaches.length) {
    console.error(`\nThreshold breaches:\n  ${breaches.join("\n  ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(2);
});
