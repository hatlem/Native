# End-to-end smoke suite

Browser-level checks against a running app with a seeded database. Plain
`node:test` files driven by `playwright-core` (already a devDependency) — no
extra test runner.

```bash
# 1. a seeded database and a running app (any port)
pnpm prisma migrate deploy && pnpm db:seed
pnpm dev -p 3100            # or: pnpm build && pnpm exec next start -p 3100

# 2. run the suite
E2E_BASE_URL=http://localhost:3100 pnpm test:e2e
```

Environment:

| Variable | Default | Purpose |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:3000` | The app under test |
| `DATABASE_URL` | — (required) | Same database the app uses; the suite creates a throwaway foreign organisation in it and deletes it afterwards |
| `E2E_BUYER_EMAIL` / `E2E_BUYER_PASSWORD` | the seeded demo buyer | Account to sign in with |
| `E2E_CHROMIUM_PATH` | playwright-core's own browser | Path to a Chromium binary when the bundled one is not installed |

Only run it against a disposable database (local or CI) — never production.

## What it covers

| File | Checks |
|---|---|
| `smoke.test.mjs` | health endpoint; public catalog renders; a signed-out visit to a protected page redirects to sign-in; the seeded buyer can sign in; a buyer gets 404 for another organisation's request, in the page and via the PDF/export routes; a buyer's RSC request to desk pages returns no desk data |

Add a file per flow (`signup.test.mjs`, `rfq-to-order.test.mjs` …) and reuse
`helpers.mjs`.
