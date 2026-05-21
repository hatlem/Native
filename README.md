# BeNative

Nordic marketplace for buying **native content** and **native advertising** in
newspapers and magazines — transparent catalog + pricing, a managed buying desk,
and in-house content production.

See [`PLAN.md`](./PLAN.md) for the full product, architecture and roadmap plan.
This is the **Phase 0** scaffold: the catalog data model plus a runnable,
multilingual public catalog.

## Stack

- Next.js (App Router) + TypeScript
- PostgreSQL via Prisma
- next-intl (en / no / sv / da), multi-currency (NOK / SEK / DKK)

## Prerequisites

- Node 22+, pnpm 10+
- PostgreSQL 16 (use `docker compose up -d db` for a local instance)

## Setup

```bash
cp .env.example .env          # set DATABASE_URL and AUTH_SECRET
pnpm install
pnpm prisma migrate deploy    # or: pnpm prisma:migrate (dev)
pnpm db:seed                  # seed Nordic catalog + desk admin user
pnpm dev                      # http://localhost:3000  -> redirects to /en
```

The internal desk console (`/[locale]/desk`) requires a `DESK` /
`SUPERADMIN` login; the publisher portal (`/[locale]/publisher`)
requires a `PUBLISHER` login. The seed creates demo accounts:

- Super admin: `superadmin@benative.example` / `benative-superadmin`
  (gets the extra **Titles & magazines** review page at
  `/[locale]/desk/titles` — every Nordic magazine is seeded inactive so
  the super admin can check whether the publisher offers native and
  turn the ones that do into live catalog titles)
- Desk: `desk@benative.example` / `benative-desk`
- Publisher: `publisher@benative.example` / `benative-pub` (mapped to
  the "Schibsted" publisher)

Override via `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`,
`DESK_ADMIN_EMAIL` / `DESK_ADMIN_PASSWORD` and `PUBLISHER_EMAIL` /
`PUBLISHER_PASSWORD`.

Catalog: `/en/catalog` (also `/no`, `/sv`, `/da`). Filter by market, format and
free-text search.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Run the dev server |
| `pnpm build` | `prisma generate` + `next build` |
| `pnpm start` | Run the production build |
| `pnpm lint` | ESLint (next) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm prisma:migrate` | Create/apply a dev migration |
| `pnpm prisma:deploy` | Apply migrations (CI/prod) |
| `pnpm db:seed` | Seed catalog data |

## What's implemented in Phase 0

- Full data model (`prisma/schema.prisma`) — catalog + commerce/content entities
  (catalog is the focus; the rest gates later phases).
- Seeded Nordic catalog: NO/SE/DK markets, publishers, titles, products,
  per-product price rules and content specs.
- Multilingual public catalog page with market/format/search filters and
  **indicative** "from" pricing (firm pricing is a desk Quote — Phase 1).

## Next (Phase 1 — see PLAN.md)

Public title detail, compare/plan basket, RFQ submission, and the internal
desk console to turn requests into quotes and orders.
