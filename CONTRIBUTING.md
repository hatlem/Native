# Contributing

How changes reach production, and the rules that keep that safe. `main`
auto-deploys to production, so everything here is about what may land on `main`.

## Workflow

1. Branch from `main`. Never commit to `main` directly.
2. Open a pull request. CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml))
   runs lint + typecheck, unit tests, integration tests against a disposable
   Postgres, a production build with the browser smoke suite, and the
   security job (dependency audit, secret scan).
3. Merge when CI is green and the change has been reviewed. Squash or merge
   commit — do not rewrite `main`.

### Branch protection (GitHub → Settings → Branches → `main`)

These settings live in GitHub, not in the repository, and must be switched on
by the owner:

- [ ] Require a pull request before merging (no direct pushes, including admins)
- [ ] Require status checks to pass: `lint + typecheck`, `unit tests`,
      `integration tests`, `build + e2e smoke`, `security`
- [ ] Require branches to be up to date before merging
- [ ] Require review from Code Owners ([`.github/CODEOWNERS`](./.github/CODEOWNERS))
      — with a single maintainer, at minimum require the PR and the checks,
      and read your own diff in the PR view before merging
- [ ] Block force pushes and deletions
- [ ] In Railway: enable *Wait for CI* on the service so a red `main` is not deployed

### Bus factor

One person can currently deploy and fix production. Until a second person
can: keep [`docs/runbooks/`](./docs/runbooks/) current, keep every credential
in a shared password manager owned by the company (not a personal account),
and make sure a second named person has Railway, GitHub, Cloudflare, Resend
and domain-registrar access and has done the rollback drill once.

## Local setup

See the README. Short version: `docker compose up -d db`, copy
`.env.example` to `.env` with the local `DATABASE_URL`, `AUTH_SECRET` and
`ALLOW_LOCAL_DB=1`, then `pnpm install && pnpm prisma migrate deploy && pnpm db:seed && pnpm dev`.

Before pushing: `pnpm lint && pnpm typecheck && pnpm test`. For anything
touching the database or a server action, also
`RUN_DB_IT=1 pnpm test:it` against the local database.

## Database migrations: expand, then contract

Migrations run in Railway's pre-deploy step **while the previous version is
still serving traffic**, and Prisma migrations cannot be rolled back. So a
migration must never break the version that is currently running.

**Allowed in one deploy (expand):**

- new table; new nullable column or column with a default; new index
  (`CREATE INDEX CONCURRENTLY` for large tables — in its own migration, since
  it cannot run inside a transaction); new enum value.

**Never in the same deploy as the code change that needs it (contract):**

- dropping or renaming a column or table; changing a column's type; making a
  column `NOT NULL`; removing an enum value; adding a constraint existing
  rows may violate.

Do those in steps, each its own PR and deploy:

1. **Expand** — add the new column/table. Old code ignores it.
2. **Migrate code** — write to both (or read new, fall back to old); backfill
   existing rows in batches.
3. **Contract** — once no running code reads the old shape, drop it.

Every migration with a destructive statement starts with a comment that
states (a) why it is safe now (which deploy removed the last reader) and
(b) the SQL that reverses it, or "irreversible — snapshot taken" with the
snapshot's name ([`docs/runbooks/backup-restore.md`](./docs/runbooks/backup-restore.md) §1).

## One-off data changes

There is no staging database yet, so data fixes run against production.
Until there is:

- prefer a migration (reviewed, runs once, recorded) over a script;
- a script in `scripts/` must be idempotent, default to a dry run that
  prints what it would change, and only write with an explicit flag;
- take a snapshot first (runbook §1) and say in the PR what was run and when;
- delete dated one-off scripts once they have been executed — git keeps them.

## Code conventions

- **Authorization lives in the page/action/route itself**, not only in a
  layout or the UI. Desk pages call `requireDesk(locale)`; superadmin pages
  use `superadminPageGate`; anything organisation-scoped goes through
  `src/lib/scope.ts`. A layout redirect does not stop the page segment from
  rendering (this leaked desk data once — see the e2e regression test).
- **Every query on customer data is scoped** to the caller's organisation(s)
  or publisher. No bare `findUnique({ where: { id } })` on a tenant-owned row
  without an ownership check right after it.
- **Logging:** `log.info/warn/error("area.event_name", { ids })` from
  `src/lib/log.ts`. No free-text `console.log`. Never log tokens, passwords,
  email bodies or full request bodies.
- **External calls have a deadline:** `fetchWithTimeout` (`src/lib/fetch-timeout.ts`)
  or `AbortSignal.timeout(...)`.
- **New environment variable:** add it to `src/lib/env.ts` and `.env.example`
  in the same PR.
- **User-facing text** goes through next-intl and exists in all six locale
  files (`src/messages/*.json`); `locale-parity.test.ts` enforces it.
- **Lists that can grow are paginated** (`src/lib/pagination.ts`, `Pager`).
- **Tests** live next to the code (`*.test.ts`, DB-backed ones `*.it.test.ts`).
  A bug fix comes with the test that would have caught it.

## Decisions

Significant choices (a new dependency, a data-model direction, how
authorization works) get a short record in [`docs/adr/`](./docs/adr/).
