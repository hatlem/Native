# Sandbox / staging environment — setup playbook

**Status:** Not provisioned. This doc captures the steps so it can be set
up when an actual partner needs it.

**Why we don't have one yet:** GroupM-class partners (Tobias scenario)
flagged sandbox-vs-production as a Phase-3 dealbreaker, but no partner
has formally asked for one yet. Provisioning costs ~€20-30/mo for the
Railway service + Postgres + domain, and the seed cost is a one-time
~1 day of engineering. Trigger the spend when we have a named partner.

## What "sandbox" means here

A separate full-stack instance of NativeSpin running on:

- Its own Railway service (separate from `nativespin` production).
- Its own Postgres (seeded with a stable, non-prod catalog).
- Its own subdomain — proposal: `sandbox.nativespin.com`.
- Its own Resend domain — proposal: `noreply@sandbox.nativespin.com`,
  also verified in Resend.
- Its own GetMailer routing so partner test signups don't pollute the
  prod inbox.

Goal: a partner can issue themselves bearer keys against the sandbox,
build adapters, and run integration tests against the same API contract
as prod — without touching prod data, sending prod emails, or paying
for prod CPU.

## Provisioning steps (when needed)

1. **Railway service.** New Railway project `nativespin-sandbox` →
   service `Native-Sandbox` linked to the same GitHub repo + branch
   `main`. Build command + start command identical to prod.
2. **Postgres.** New Railway Postgres on the same project. Capture
   `DATABASE_URL` into the service env.
3. **Env vars on the sandbox service:**
   - `NEXT_PUBLIC_SITE_URL=https://sandbox.nativespin.com`
   - `NEXTAUTH_URL=https://sandbox.nativespin.com`
   - `AUTH_SECRET=<new secret, not prod's>`
   - `RESEND_API_KEY=<separate Resend key, sandbox-scoped>`
   - `AUTH_EMAIL_FROM=NativeSpin Sandbox <noreply@sandbox.nativespin.com>`
   - `DATABASE_URL=<sandbox Postgres URL>`
   - All other env vars copied from prod (review for any prod-only keys
     first — e.g. live Stripe keys must NOT be copied).
4. **Domain.** Railway custom-domain `sandbox.nativespin.com` →
   Cloudflare DNS CNAME → Railway. Wait for TLS issuance.
5. **Seed.** Run `pnpm prisma migrate deploy` + `pnpm db:seed` against
   the sandbox `DATABASE_URL`. The seed deliberately ships a small,
   stable test catalog (~50 titles spanning all 9 markets) — *not*
   the full 3,152-title prod catalog.
6. **Resend domain verification.** Add `sandbox.nativespin.com` to
   Resend, complete DNS verification.
7. **Documentation page.** Add a sandbox section to `/api` describing:
   - Sandbox base URL.
   - How to request a sandbox API key (mailto: partners@nativespin.com
     with subject "sandbox key").
   - The fact that the catalog is a stable test set, not a mirror of
     prod.
   - The expected refresh cadence (manual; reset on request).

## Partner workflow once provisioned

1. Partner emails `partners@nativespin.com` for sandbox access.
2. Super-admin issues a `catalog:read` (and optionally `catalog:*`)
   API key against the sandbox instance via `/desk/api-keys` on the
   sandbox URL.
3. Partner builds + tests against `https://sandbox.nativespin.com`
   for as long as they need.
4. When they're ready for prod, super-admin issues a separate prod
   API key. **Keys do NOT transfer between sandbox + prod** — they're
   different Postgres databases.

## What NOT to do

- Don't seed sandbox from a prod dump. Real publisher contact data
  + real customer org names + real audit log = sandbox becomes a
  prod-data exfiltration vector.
- Don't share Resend domain between sandbox + prod. Prod email
  reputation must not be affected by sandbox test traffic.
- Don't proxy sandbox writes back into prod. Sandbox is fully isolated.
- Don't auto-sync the catalog from prod nightly. Manual reset on
  partner request — the goal is stable test data, not live mirror.

## Cost estimate

| Item | Monthly cost |
|---|---|
| Railway service (1 CPU, 1 GB) | ~€12 |
| Railway Postgres (1 GB) | ~€8 |
| Cloudflare DNS | €0 |
| Resend (sandbox volume) | included in current plan |
| **Total** | **~€20-25** |

Trivial for any active partner; over-spend without one.
