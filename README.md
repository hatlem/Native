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

- **Next.js 15** (App Router) + React 19 + TypeScript (strict)
- **PostgreSQL** via **Prisma 6**
- **next-intl** — 6 locales (en / no / sv / da / de / fi), multi-currency (NOK / SEK / DKK), per-market VAT
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
cp .env.example .env          # set DATABASE_URL and AUTH_SECRET
pnpm install
pnpm prisma migrate deploy    # or: pnpm prisma:migrate (dev)
pnpm db:seed                  # seed catalog + demo desk/publisher accounts
pnpm dev                      # http://localhost:3000  -> redirects to /en
```

Email and R2 are optional in dev — when `RESEND_API_KEY` / R2 vars are unset,
emails are logged to the console and blob uploads are skipped. See
[`.env.example`](./.env.example) for the full list (outreach send caps,
GTM/Consent Mode, site URL, seed account overrides).

### Demo accounts

The seed creates three role-gated logins:

- **Super admin** — `superadmin@nativespin.com` / `nativespin-superadmin`
  (also gets the **Titles & magazines** review page at `/[locale]/desk/titles` —
  every magazine is seeded inactive so the admin can confirm a publisher offers
  native and promote the ones that do into live catalog titles)
- **Desk** — `desk@nativespin.com` / `nativespin-desk`
- **Publisher** — `publisher@nativespin.com` / `nativespin-pub` (mapped to the "Schibsted" publisher)

Override via `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`,
`DESK_ADMIN_EMAIL` / `DESK_ADMIN_PASSWORD`, and `PUBLISHER_EMAIL` / `PUBLISHER_PASSWORD`.

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
| `pnpm start` | `prisma migrate deploy` + `next start` (production) |
| `pnpm lint` | ESLint (next) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Run the unit tests (`tsx --test`) |
| `pnpm prisma:migrate` | Create/apply a dev migration |
| `pnpm prisma:deploy` | Apply migrations (CI/prod) |
| `pnpm db:seed` | Seed catalog + demo accounts |
| `pnpm scrape-contacts` | Scrape publisher/sales-house contacts |
| `pnpm build-rate-card-campaign` | Assemble a rate-card outreach campaign |
| `pnpm send-rate-card-batch` | Send the next capped batch of outreach email |

Additional one-off operational scripts live in [`scripts/`](./scripts/)
(contact loading, MCP key issuance, digital-reach enrichment, data cleanup,
user/rebrand migrations).

## Testing

Unit tests run with the Node test runner via `tsx` (`pnpm test`) and live
alongside the code as `*.test.ts` — concentrated in `src/lib` (pricing
visibility, basket, quotes, membership/roles, outreach scoring/dedup/sequence,
email policy, security). End-to-end and scenario testing is driven through the
live product (see [`testit.md`](./testit.md) and `scenario-runs/`).

## Deployment

Railway, configured in [`railway.json`](./railway.json): NIXPACKS build,
`pnpm start` (which runs migrations before serving), healthcheck on
`/api/health`. `main` auto-deploys to production. Conservative baseline security
headers are set in [`next.config.ts`](./next.config.ts) (no CSP yet — tracked as
a follow-up).

## Status

The catalog, RFQ/quote/order commerce flow, content-production workflow,
invoicing, publisher portal, public API + MCP, and the publisher-outreach engine
are all implemented. Roadmap and remaining automation/self-serve work are tracked
in [`PLAN.md`](./PLAN.md).
