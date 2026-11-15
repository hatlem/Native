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

Starting targets — tighten them once there is a baseline from staging:

| Measure | Target |
|---|---|
| p95, public pages and title page | ≤ 800 ms at 25 concurrent users |
| p95, signed-in buyer pages | ≤ 1 500 ms at 25 concurrent users |
| p95, `GET /api/v1/catalog/titles` | ≤ 300 ms |
| p95, `/api/health` | ≤ 200 ms at every stage |
| Error rate | < 1 % at every stage up to the expected peak, 0 % at 10 users |
| Saturation | throughput still growing at 2× the expected peak concurrency |

Run it before a launch or campaign that will bring traffic, after changes to
the catalog queries or the layout's data loading, and after resizing the
Railway instance or the database.

## Baseline (15 Nov 2026)

Single `next start` process and Postgres on one small sandbox machine, the
load generator on the same machine — so absolute numbers are pessimistic and
only the shape is meaningful. 5 → 15 → 30 users, no think time, 1 202 requests,
0 errors.

| Stage | req/s | p50 | p95 | p99 |
|---|---|---|---|---|
| 5 users | 20.5 | 235 ms | 501 ms | 588 ms |
| 15 users | 22.1 | 656 ms | 1 263 ms | 1 481 ms |
| 30 users | 22.6 | 1 364 ms | 2 469 ms | 2 775 ms |

Throughput is flat at about 22 req/s from the first stage: one Node process
rendering these pages is CPU-bound there, and added users only queue. Slowest
at 30 users (p95): buyer plan 2.9 s, buyer catalog search 2.5 s, buyer catalog
2.2 s, title page 2.1 s; the API and health check stayed under 310 ms. The
pages are also heavy to produce and send: 330–660 KB of HTML each (landing
664 KB, signed-in catalog 603 KB). The API was throttled on 106 of 144 calls
by its per-key rate limit, as designed.
