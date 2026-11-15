# NativeSpin

European marketplace for buying **native content** and **native advertising** in
newspapers and magazines — a transparent catalog + pricing, a managed buying
desk that purchases on the customer's behalf, and in-house content production.

Most premium editorial inventory is sold manually: fragmented titles, opaque
rate cards, a sales rep per publisher, no single place to compare or book.
NativeSpin aggregates that supply, makes pricing and specs comparable, and runs
the buying as a managed desk so advertisers get one catalog, one quote, one order.

See [`PLAN.md`](./PLAN.md) for the full product, architecture, and roadmap.

## Who it's for

| Side | Who | Where |
|---|---|---|
| **Demand** | Advertisers & agencies | Public catalog, plan/basket, RFQ → quote → order, invoices, reports |
| **Supply** | Publishers | Portal to claim titles, set availability, manage orders |
| **Internal** | NativeSpin desk / admin | Console to turn requests into quotes and orders, manage titles & contacts, run publisher outreach |

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript (strict)
- **PostgreSQL** via **Prisma 6**
- **next-intl** — 6 locales (en / no / sv / da / de / fi), multi-currency (NOK / SEK / DKK), VAT by the buyer's country (domestic rate or reverse charge — `src/lib/vat.ts`)
- **Auth.js (NextAuth v5)** — credentials + email magic links, role-gated areas
- **Resend** for transactional + outreach email (inbound webhook auto-suppresses bounces/complaints)
- **Cloudflare R2** (S3 API) for blob storage (rate-card PDFs, placement images)
- A versioned **public API** (`/api/v1`) with an OpenAPI spec, API keys, and an **MCP** server
- Deployed on **Railway** (NIXPACKS, healthcheck at `/api/health`)

## Prerequisites

- Node 22+, pnpm 10+
- PostgreSQL 16 (use `docker compose up -d db` for a local instance)

## Setup

```bash
cp .env.example .env          # set DATABASE_URL, AUTH_SECRET and ALLOW_LOCAL_DB=1 (see below)
pnpm install
pnpm prisma migrate deploy    # or: pnpm prisma:migrate (dev)
pnpm db:seed                  # seed catalog + demo desk/publisher accounts
pnpm dev                      # http://localhost:3000  -> redirects to /en
```

For the docker-compose database use
`DATABASE_URL="postgresql://atnative:atnative@127.0.0.1:5432/atnative?schema=public"`.
`ALLOW_LOCAL_DB=1` is required: `src/lib/prisma.ts` refuses a localhost
`DATABASE_URL` without it, so that nobody edits a stale local copy by accident
when they meant production (see the note at the top of `.env.example`).

Email and R2 are optional in dev — when `RESEND_API_KEY` / R2 vars are unset,
emails are logged to the console and blob uploads are skipped. See
[`.env.example`](./.env.example) for the full list (outreach send caps,
GTM/Consent Mode, site URL, seed account overrides).

### Demo accounts

The seed creates these role-gated logins (already email-verified, so they can
sign in straight away; the seed refuses the default passwords against a
non-local database). There are also `buyer@nativespin.com` / `nativespin-buyer`
and `agency@nativespin.com` / `nativespin-agency` for the buyer side:

- **Super admin** — `superadmin@nativespin.com` / `nativespin-superadmin`
  (also gets the **Titles & magazines** review page at `/[locale]/desk/titles` —
  every magazine is seeded inactive so the admin can confirm a publisher offers
  native and promote the ones that do into live catalog titles)
- **Desk** — `desk@nativespin.com` / `nativespin-desk`
- **Publisher** — `publisher@nativespin.com` / `nativespin-pub` (mapped to the "Schibsted" publisher)

Override via `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`,
`DESK_ADMIN_EMAIL` / `DESK_ADMIN_PASSWORD`, and `PUBLISHER_EMAIL` / `PUBLISHER_PASSWORD`.

### Two-factor authentication

Any user can add an authenticator-app code (TOTP, RFC 6238) as a second
sign-in step at `/[locale]/account/security`; ten one-time recovery codes are
shown once at enrolment. With it on, a password or an email link only gets the
browser to `/[locale]/signin/mfa` — no session exists until the code checks out.

- **Require it for staff:** set `MFA_REQUIRED_FOR_STAFF=1`. `DESK` and
  `SUPERADMIN` users without two-factor are then redirected to enrol before any
  desk page or action runs (`src/lib/desk-guard.ts`). It is off by default so a
  deploy never locks the desk out: deploy, have staff enrol, then set the flag.
- **Locked-out user** (lost phone and recovery codes): after verifying who they
  are, run `pnpm tsx scripts/reset-mfa.ts <email> --by <you>`. It clears their
  two-factor, ends their sessions and writes an `auth.mfa_reset` audit row.
- TOTP secrets are AES-256-GCM encrypted with a key derived from `AUTH_SECRET`;
  rotating `AUTH_SECRET` therefore requires everyone to enrol again.

## Key routes

All app routes are locale-prefixed (`/en`, `/no`, `/sv`, `/da`, `/de`, `/fi`).

| Area | Path | Access |
|---|---|---|
| Marketing site | `/`, `/how-it-works`, `/pricing`, `/for-advertisers`, `/for-agencies`, `/for-publishers` | Public |
| Catalog | `/catalog`, `/catalog/[slug]`, `/catalog/compare` | Public (filter by market / format / search) |
| Plan & request | `/plan`, `/recommend`, `/requests`, `/price-request/[token]` | Buyer |
| Orders & billing | `/orders`, `/invoices`, `/reports` | Buyer |
| Desk console | `/desk` — requests, `/desk/price-quotes`, `/desk/orders`, `/desk/titles`, `/desk/publisher-contacts`, `/desk/api-keys` | `DESK` / `SUPERADMIN` |
| Publisher portal | `/publisher`, `/publisher/availability`, `/publisher/orders`, `/publisher/claim/[token]` | `PUBLISHER` |
| Account & orgs | `/account`, `/onboarding`, `/invite/[token]`, `/agency` | Authenticated |
| Public API | `/api/v1/catalog/titles`, `/api/v1/quotes/[id]`, `/api/openapi.json` (also `/.well-known/openapi.json`) | API key |
| MCP server | `/api/mcp` | API key |
| Health | `/api/health` | Public (verifies DB connectivity) |

## Architecture highlights

- **Catalog → commerce → content pipeline.** The Prisma schema models the whole
  lifecycle: `Market → Publisher → Title → Product` (with `PriceRule` + `Spec`),
  then `Plan → Request → Quote → Order → Invoice/CreditNote`, then content
  production (`ContentBrief → ContentAsset` with per-publisher spec checks and a
  publisher editorial veto). Pricing is `INDICATIVE` in the catalog and becomes
  `FIRM` only on a desk-issued quote.
- **Two revenue streams.** Inventory buying margin (`PriceRule.marginPct`) and
  content-production fees (`ContentFeeRule` → `CONTENT_FEE` quote/order lines,
  opt-in per placement). The desk reports show the realized **margin-vs-content-fee
  split**, so the monetization mix is tuned from data.
- **Pricing intelligence & playbooks (Phase 4).** `suggestMargin` recommends the
  highest margin that historically still won the deal (advisory, never
  auto-applied); category **benchmarks** and **content playbooks** (matched per
  placement) close the optimization loop. See `src/lib/pricing-intelligence.ts`,
  `src/lib/playbook.ts`.
- **Publisher ingestion.** `catalog:write` API keys bound to a single publisher
  push inventory via `PUT /api/v1/publisher/products` (idempotent on
  `externalRef`; new titles stay inactive until curation). See
  [`docs/publisher-ingestion.md`](./docs/publisher-ingestion.md).
- **Multi-tenant orgs & roles.** Organizations (advertiser/agency) with
  memberships, org invites, and scoped roles (`BUYER`, `APPROVER`, `ORG_ADMIN`,
  `DESK`, `CONTENT`, `PUBLISHER`, `SUPERADMIN`). Access is enforced server-side
  (`src/lib/roles.ts`, `scope.ts`, `membership.ts`).
- **Supply-acquisition outreach engine** (`src/lib/outreach`, `scripts/`).
  Scrapes and scores publisher/sales-house contacts, dedups them, and runs
  capped rate-card request campaigns over Resend with suppression handling and a
  signed link/price-request flow. Sales-house routing maps long-tail titles to
  the houses that sell them. See [`docs/publisher-outreach.md`](./docs/publisher-outreach.md)
  and [`docs/sales-house-routing.md`](./docs/sales-house-routing.md).
- **Public API + MCP.** Versioned REST under `/api/v1` (API-key auth, OpenAPI
  spec, partner webhooks) plus an MCP server so the catalog/quotes are reachable
  by agent tooling.
- **i18n-first copy.** Source language is English (`src/messages/en.json` +
  `src/messages/landing/en/*`), translated to the other 5 locales.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Run the dev server |
| `pnpm build` | `prisma generate` + `next build` |
| `pnpm start` | `prisma migrate deploy` + `next start` (standalone; Railway instead runs migrations in `preDeployCommand`) |
| `pnpm lint` | ESLint (next) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Run the unit tests (`tsx --test`) |
| `pnpm test:it` | DB-backed integration tests (`RUN_DB_IT=1` for the full set; disposable DB only) |
| `pnpm test:e2e` | Browser smoke suite against a running app (see [`e2e/README.md`](./e2e/README.md)) |
| `pnpm prisma:migrate` | Create/apply a dev migration |
| `pnpm prisma:deploy` | Apply migrations (CI/prod) |
| `pnpm db:seed` | Seed catalog + demo accounts |
| `pnpm scrape-contacts` | Scrape publisher/sales-house contacts |
| `pnpm build-rate-card-campaign` | Assemble a rate-card outreach campaign |
| `pnpm send-rate-card-batch` | Send the next capped batch of outreach email |
| `pnpm seed-content-fees` | Insert default content-fee rules (idempotent; safe in prod) |
| `pnpm seed-playbooks` | Insert starter content playbooks (idempotent; safe in prod) |
| `pnpm issue-publisher-key <publisher>` | Issue a `catalog:write` ingestion key bound to a publisher |

Additional one-off operational scripts live in [`scripts/`](./scripts/)
(contact loading, MCP key issuance, digital-reach enrichment, data cleanup,
user/rebrand migrations).

## Testing

Unit tests run with the Node test runner via `tsx` (`pnpm test`) and live
alongside the code as `*.test.ts` — concentrated in `src/lib` (pricing
visibility, basket, quotes, membership/roles, outreach scoring/dedup/sequence,
email policy, security). DB-backed integration tests (`*.it.test.ts`,
`pnpm test:it`) run against a disposable Postgres. A browser smoke suite lives
in [`e2e/`](./e2e/README.md) (`pnpm test:e2e`): sign-in, catalog, and the
cross-tenant / desk-data isolation checks. CI runs all three on every push
([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)). Manual scenario
runs against the live product are kept as local notes (`testit.md`,
`scenario-runs/` — both gitignored).

## Deployment

Railway, configured in [`railway.json`](./railway.json): NIXPACKS build,
migrations in `preDeployCommand` (`pnpm prisma migrate deploy`, before the new
version takes traffic), start with `pnpm next start`, healthcheck on
`/api/health` (verifies the database). `main` auto-deploys to production.
Security headers are set in [`next.config.ts`](./next.config.ts); the
nonce-based Content-Security-Policy is set per request in
[`src/middleware.ts`](./src/middleware.ts).

Because migrations run while the previous version is still serving, schema
changes follow expand/contract — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Operations

- **Logs.** Server code logs one JSON object per line through
  [`src/lib/log.ts`](./src/lib/log.ts) (`event`, `level`, ids). Every request
  carries an `x-request-id` (set in middleware, echoed on the response) so a
  user-reported failure can be found in the logs; unhandled request errors are
  logged by `onRequestError` in [`src/instrumentation.ts`](./src/instrumentation.ts)
  with the same digest the error page shows.
- **Alerts.** Set `ERROR_WEBHOOK_URL` (Slack/Discord incoming webhook) and every
  error-level log line posts a rate-limited alert. Without it, errors are only
  in the Railway logs.
- **Environment.** [`src/lib/env.ts`](./src/lib/env.ts) validates the
  environment at boot: a production server without `DATABASE_URL` /
  `AUTH_SECRET` refuses to start; malformed or missing optional settings are
  logged as `env.invalid` / `env.degraded`.
- **Background jobs.** The autosend, metrics, price-band and placement-ready
  sweeps ([`src/lib/sweeps.ts`](./src/lib/sweeps.ts)) run hourly on in-process
  timers by default. To run them from a scheduler instead (survives deploys,
  keeps a run history): set `CRON_SECRET`, add a Railway cron service that
  runs `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/sweeps`
  hourly, then set `IN_PROCESS_SWEEPS=0`. The endpoint answers 500 when any
  sweep fails, so the scheduler shows the run as failed. Running both at once
  is safe (advisory locks / daily latch).
- **Partner webhooks** are retried up to 3 times with backoff and carry a
  timestamped signature (`X-NativeSpin-Signature-V1` over
  `<timestamp>.<body>`) next to the original body-only one — see
  [`src/lib/webhooks.ts`](./src/lib/webhooks.ts).
- **Runbooks.** [`docs/runbooks/`](./docs/runbooks/): backup & restore,
  rollback, incident response. Architecture decisions are recorded in
  [`docs/adr/`](./docs/adr/).

## Status

The catalog, RFQ/quote/order commerce flow, content-production workflow,
invoicing, publisher portal, public API + MCP, the publisher-outreach engine, the
content-fee revenue stream + margin/fee reporting, Phase-4 pricing intelligence /
benchmarks / content playbooks, and the publisher programmatic-ingestion API are
all implemented. Accounting export is provider-neutral (`src/lib/accounting.ts` +
structured JSON at `/api/export/invoices/accounting.json`); a **live** push to an
accounting SaaS (Fiken adapter scaffolded) is the one remaining step and needs
provider credentials. Roadmap is tracked in [`PLAN.md`](./PLAN.md).
