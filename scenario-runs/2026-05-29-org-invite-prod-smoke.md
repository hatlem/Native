# Org-Invite — Production Smoke Test (focused, not a saved scenario)

**Date:** 2026-05-29  **Target:** https://nativespin.com (prod)  **Tool:** claude-in-chrome
**Inbox:** getmailer API (catch-all @getia.no) for magic-link + invite emails

## Scope
Validate the shipped multi-user org-invite feature end-to-end live: signup→ADMIN membership, magic-link sign-in, admin invite, claim (new user), per-member role/commit gating. Order placement / partner-facing steps intentionally skipped (canCommitOnOrg + submitRequest gate are unit-tested).

## Result: PASS (all checked steps)
| Step | Result | Evidence |
|---|---|---|
| Fresh signup creates ADMIN membership | PASS | Admin reached Team→invite form (admin-gated) — proves register fix live |
| Magic-link sign-in | PASS | Signed in as admin via emailed link; landed on /account (proves localhost:8080 redirect fix) |
| Admin invites Member (commit off) | PASS | Invite email delivered to invitee (Resend→getmailer) |
| Email-mismatch claim state | PASS | "Wrong account" page when opening invite while logged in as admin |
| New-user claim | PASS | Email pinned; created account, "You have joined the organisation", auto-signed-in |
| Per-member role gating | PASS | Member sees roster (Maja=Admin/commit Yes, Sondre=Member/commit No) but NO invite form |

## Bugs found + fixed during this effort (both shipped to prod, verified)
1. CRITICAL — new-signup org creation didn't create an ADMIN Membership → new advertisers locked out of checkout/invite. Fixed in register tx + idempotent backfill migration (commit 782878a).
2. CRITICAL — magic-link error redirects used req.url → pointed at https://localhost:8080 in prod (dead end for expired/used/invalid links). Fixed to appUrl() (commit e7553d9). Verified: redirect now → nativespin.com.

## Not exercised (by design)
- Actual quote-accept/order-placement block for the no-commit member (would create real partner-facing order). Logic covered by unit tests (canCommitOnOrg, submitRequest gate).

## Test accounts created on prod (cleanup needed — couldn't delete; prod DB is internal-only)
- orgtest-admin-mpr698yj@nativespin.com (unverified orphan from a routing dead-end; @nativespin.com isn't getmailer catch-all)
- orgtest-admin-mpr698yj@getia.no (verified admin, org "Hovedstien QA mpr698yj")
- orgtest-invitee-mpr698yj@getia.no (verified member of that org)

## Pre-existing follow-up noted
- updateCompany / company-info edit is available to non-admin members (Member saw "Save company info"). Pre-existing "tighten when multi-seat lands" — now applicable.
