# Load test

`scripts/loadtest/run.mjs` ramps concurrent virtual users over a weighted mix
of real pages and reports p50 / p95 / p99, error rate and throttling per
endpoint. Plain Node, no dependencies. It only reads: no request, order or
email is created.

## What it hits

| Group | Endpoints | Needs |
|---|---|---|
| Public | landing, catalog, catalog search | — |
| Title page | `/catalog/<slug>` for up to 12 titles found in the catalog | — |
| Buyer | catalog, catalog search, home, requests, plan, invoices | `LOADTEST_EMAIL` + `LOADTEST_PASSWORD` (an account **without** two-factor), or `LOADTEST_COOKIE` |
| API | `GET /api/v1/catalog/titles` | `LOADTEST_API_KEY` (`pnpm tsx scripts/issue-buyer-key.ts "<org>"`) |
| Health | `/api/health` | — |

## Running it

Local, against a production build:

```bash
pnpm build && pnpm exec next start -p 3000 &
LOADTEST_EMAIL=buyer@nativespin.com LOADTEST_PASSWORD=nativespin-buyer pnpm loadtest
```

Against staging (never production):

```bash
LOADTEST_BASE_URL=https://staging.nativespin.example \
LOADTEST_ALLOW_REMOTE=1 \
LOADTEST_EMAIL=loadtest@yourcompany.example LOADTEST_PASSWORD=… \
LOADTEST_API_KEY=… \
LOADTEST_STAGES=10:60,25:120,50:120,100:120 \
LOADTEST_P95_MS=1500 LOADTEST_MAX_ERROR_RATE=0.01 \
LOADTEST_OUT=loadtest-$(date +%F).json \
pnpm loadtest
```

The script refuses any non-local host unless `LOADTEST_ALLOW_REMOTE=1` is set.
Staging must have its own database: the buyer pages are read-only here, but a
load test on the production database competes with real customers.

| Variable | Default | Meaning |
|---|---|---|
| `LOADTEST_BASE_URL` | `http://localhost:3000` | App under test |
| `LOADTEST_STAGES` | `5:15,15:30,30:30` | `users:seconds` per stage, comma-separated |
| `LOADTEST_THINK_MS` | `0` | Pause per user between requests. `0` is a stress test; `1000`–`3000` approximates real users |
| `LOADTEST_TIMEOUT_MS` | `30000` | Per-request timeout (counted as an error) |
| `LOADTEST_P95_MS` | — | Fail (exit 1) if any endpoint's p95 exceeds this |
| `LOADTEST_MAX_ERROR_RATE` | — | Fail if the overall error rate exceeds this fraction |
| `LOADTEST_OUT` | — | Write the full JSON report here |
| `LOADTEST_TITLE_SLUGS` | discovered | Comma-separated title slugs to use instead |
| `LOADTEST_LOCALE` | `en` | Locale prefix |

A 429 is counted as *throttled*, not as an error: the rate limiter doing its
job. Errors are timeouts, network failures, 5xx and unexpected statuses.

## Reading the result

Each stage prints throughput and latency; the table lists endpoints slowest
first with p95 per stage. Three things to look for:

1. **Where throughput stops growing.** If req/s is flat from one stage to the
   next while latency doubles, the app is saturated at that throughput.
2. **Which endpoint degrades first.** The p95-per-stage column shows it.
3. **Errors at the top stage.** Timeouts or 5xx there mark the breaking point.

## Thresholds to hold (staging, production-sized instance)

Measured against the sandbox numbers below (one small machine, load generator
included), with headroom for a production-sized instance:

| Measure | Target |
|---|---|
| p95, public pages (landing, catalog gate, marketing pages) | ≤ 300 ms at 30 concurrent users |
| p95, title page | ≤ 1 000 ms at 25 concurrent users |
| p95, signed-in buyer pages | ≤ 1 500 ms at 25 concurrent users |
| p95, `GET /api/v1/catalog/titles` | ≤ 300 ms |
| p95, `/api/health` | ≤ 200 ms at every stage |
| Error rate | < 1 % at every stage up to the expected peak, 0 % at 10 users |
| Saturation | throughput still growing at 2× the expected peak concurrency |
| HTML per page (uncompressed) | ≤ 120 KB, except the signed-in catalog (60 result rows, ≤ 360 KB) |

Run it before a launch or campaign that will bring traffic, after changes to
the catalog queries or the layout's data loading, and after resizing the
Railway instance or the database. Also check page weight after adding client
components or messages: `curl -s localhost:3000/en/pricing | wc -c`.

## Baseline (15 Nov 2026, after the page-weight and caching work)

Single `next start` process and Postgres on one small sandbox machine (4
cores), the load generator on the same machine — so absolute numbers are
pessimistic and only the shape is meaningful. 5 → 15 → 30 users, no think
time, buyer signed in, no API key. Before and after on the same machine, same
seeded database, back to back:

| Stage | before: req/s | p50 | p95 | p99 | after: req/s | p50 | p95 | p99 |
|---|---|---|---|---|---|---|---|---|
| 5 users | 15.3 | 309 ms | 618 ms | 690 ms | 36.9 | 140 ms | 292 ms | 349 ms |
| 15 users | 19.6 | 723 ms | 1 281 ms | 1 443 ms | 39.8 | 440 ms | 795 ms | 888 ms |
| 30 users | 18.6 | 1 589 ms | 2 584 ms | 2 826 ms | 40.9 | 855 ms | 1 445 ms | 1 665 ms |

1 377 → 2 972 requests in the same 75 s, 0 errors either way.

| Endpoint | p95 before | p95 after | p95 at 30 users, after | HTML before | HTML after |
|---|---|---|---|---|---|
| public landing | 1 448 ms | 143 ms | 166 ms | 672 KB | 108 KB |
| public catalog (gate) | 1 153 ms | 116 ms | 142 ms | 493 KB | 64 KB |
| public catalog search (gate) | 1 084 ms | 104 ms | 114 ms | 493 KB | 64 KB |
| title page | 2 245 ms | 1 221 ms | 1 322 ms | 423 KB | 90 KB |
| buyer catalog | 2 426 ms | 1 395 ms | 1 418 ms | 611 KB | 347 KB |
| buyer catalog search | 2 576 ms | 1 400 ms | 1 569 ms | 583 KB | 323 KB |
| buyer plan | 2 954 ms | 1 691 ms | 1 775 ms | 344 KB | 80 KB |
| buyer home | 1 626 ms | 965 ms | 996 ms | 349 KB | 83 KB |
| buyer requests | 1 692 ms | 957 ms | 975 ms | 347 KB | 81 KB |
| buyer invoices | 1 517 ms | 923 ms | 1 080 ms | 341 KB | 77 KB |
| `/api/health` | 120 ms | 80 ms | 109 ms | — | — |

Other pages, uncompressed HTML (gzip on the wire): pricing 622 → 62 KB (15 KB),
sign-in 615 → 61 KB (16 KB), about 618 → 58 KB.

What changed, and why the numbers moved:

- **Page weight.** Every page carried the whole message catalogue (~200 KB
  of JSON) for the client, the 65 KB editorial stylesheet inline (twice on
  marketing pages, plus again in the RSC payload) and the 4 KB wordmark path
  three times. Now: only the messages client components read
  (`src/i18n/client-messages.ts`; signed-out pages get a smaller set), the
  stylesheet as a cached file (`/landing.css?v=<hash>`), the wordmark drawn
  from `/brand/nativespin-wordmark.svg`.
- **Public pages are prerendered.** A visitor without a session cookie is
  served a prerendered copy of the landing page, catalog gate and marketing
  pages (`src/app/static`, rewrite in `src/middleware.ts`, list in
  `src/lib/static-public.ts`) — no render per request. Their CSP lists the
  hashes of the page's own inline scripts instead of a nonce, stored with each
  cached page (`src/lib/static-csp-cache-handler.mjs`).
- **Shared data.** Catalog figures and showcase, the per-query catalog search
  ids and title-page data are cached across requests and expired on catalog
  writes (`src/lib/catalog-public.ts`, `src/lib/catalog-search.ts`,
  `src/lib/catalog-facets.ts`).

The process is still CPU-bound on the signed-in pages: at 30 users
throughput no longer grows (≈ 40 req/s) and latency queues. A single
signed-in page costs 30–90 ms of server CPU (the buyer catalog renders 60
result rows); the layout alone (session decode, workspace, badge counts) is
~25 ms of that. Next candidates: de-duplicate `auth()` and `getWorkspace()`
within a request (both run several times per page), and more than one Node
process per instance.

### Earlier baseline (before that work)

5 → 15 → 30 users: 20.5 / 22.1 / 22.6 req/s, p95 501 / 1 263 / 2 469 ms,
1 202 requests, 0 errors. Slowest at 30 users (p95): buyer plan 2.9 s, buyer
catalog search 2.5 s, buyer catalog 2.2 s, title page 2.1 s; 330–660 KB of
HTML per page (landing 664 KB, signed-in catalog 603 KB). The API was
throttled on 106 of 144 calls by its per-key rate limit, as designed.
