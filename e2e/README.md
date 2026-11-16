# End-to-end suite

Browser-level checks against a running app with a seeded database. Plain
`node:test` files driven by `playwright-core` (already a devDependency) — no
extra test runner.

```bash
# 1. a seeded database and a running app (any port)
pnpm prisma migrate deploy && pnpm db:seed
EMAIL_LOG_BODY=1 pnpm dev -p 3100 > /tmp/app.log 2>&1 &
#   or a production build:
#   pnpm build && EMAIL_LOG_BODY=1 pnpm exec next start -p 3100 > /tmp/app.log 2>&1 &

# 2. run the suite
E2E_BASE_URL=http://localhost:3100 E2E_APP_LOG=/tmp/app.log pnpm test:e2e

# one file
E2E_BASE_URL=http://localhost:3100 node --test e2e/journey.test.mjs
```

Environment:

| Variable | Default | Purpose |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:3000` | The app under test |
| `DATABASE_URL` | — (required) | Same database the app uses; the suites create throwaway organisations in it and delete them afterwards |
| `E2E_APP_LOG` | — | The app's log file. The app must run with `EMAIL_LOG_BODY=1` and without `RESEND_API_KEY`, so emails are printed there instead of sent. Tests that follow an emailed link (sign-up, sign-in link, invitation) skip when unset |
| `E2E_SIGNUP_DOMAIN` | `nativespin.com` | Domain for the sign-up test's address. Sign-up checks the domain has mail servers, so it must resolve; nothing is sent to it. Without DNS (sandboxes) the sign-up test skips and the journey continues with an account created in the same state |
| `E2E_BUYER_EMAIL` / `E2E_BUYER_PASSWORD` | the seeded demo buyer | Account the smoke suite signs in with |
| `E2E_DESK_EMAIL` / `E2E_DESK_PASSWORD` | the seeded desk user | Desk account that prices quotes and issues invoices |
| `E2E_CHROMIUM_PATH` | playwright-core's own browser | Path to a Chromium binary when the bundled one is not installed |

The app additionally needs the seller-of-record variables for the invoice PDF
check (`SELLER_ORG_NUMBER`, `SELLER_VAT_NUMBER`, `SELLER_ADDRESS_LINE1`,
`SELLER_POSTAL_CODE`, `SELLER_BANK_ACCOUNT`) — CI sets test values, see
`.github/workflows/ci.yml`.

Only run it against a disposable database (local or CI) — never production.
The suites write real rows (requests, quotes, orders, invoices) and advance the
invoice number series.

## What it covers

| File | Checks |
|---|---|
| `smoke.test.mjs` | health endpoint; public catalog renders; a signed-out visit to a protected page redirects to sign-in; the seeded buyer can sign in; a buyer gets 404 for another organisation's request, in the page and via the PDF/export routes; a buyer's RSC request to desk pages returns no desk data |
| `journey.test.mjs` | sign-up and the emailed verification link; onboarding; catalog → plan → request; the desk prices and sends a quote; VAT treatment and exact totals; the buyer downloads the quote (PDF, Word) and accepts; a second accept creates no second order; the desk delivers the order and issues the invoice; sequential invoice number; invoice page, list and PDF; an emailed sign-in link works once; a second organisation gets 403/404 on every id the journey produced, in pages, exports and RSC payloads |
| `self-service.test.mjs` | a buyer withdraws a request, declines a quote with a reason, and asks to cancel an order; the desk sees each reason; a withdrawn request cannot be quoted |
| `team.test.mjs` | an admin invites a colleague; the token is not stored in the clear; the colleague joins through the emailed link and sees the organisation's requests; the link works once; removal takes two clicks and ends the member's access |
| `mfa.test.mjs` | enrolment with an authenticator code (computed in the test, RFC 6238); a wrong code enables nothing; recovery codes are shown; sign-in issues no session before the code; a wrong code and a replayed code are refused |
| `a11y.test.mjs` | sign-in with the keyboard alone (skip link, focus indicator); the command palette traps focus, exposes combobox/listbox semantics and returns focus on Escape; an accessibility probe of the public, buyer and desk pages in light and dark; `lang` per locale |

The accessibility probe (`a11yProbe` in `helpers.mjs`) reports only
machine-decidable failures: images without a text alternative, form fields,
buttons and links without an accessible name, a missing `lang`, skipped
heading levels, and text contrast below WCAG AA where the background is a
solid colour. It is a floor, not an audit: it cannot judge reading order,
meaningful alt text or text over images.

## Writing more

Each file is independent: it creates its own organisation(s) with
`createFreshBuyer`, tags everything with `RUN_TAG`, and removes it in `after`
with `cleanupRun`, which walks the foreign keys so new tables need no change
here. Drive the UI; touch the database only for fixtures and to read the
outcome. Reuse `submitRequestViaUi` and `sendQuoteViaUi` to get to a quoted
request quickly.

Submit a list at most once per test organisation within ten seconds: the
checkout's double-submit guard returns the first request for a quick second
submit of the same list.
