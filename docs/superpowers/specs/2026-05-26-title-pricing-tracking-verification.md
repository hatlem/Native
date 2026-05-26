# Title pricing tracking — manual verification checklist

**Branch:** worktree-title-pricing-tracking
**Spec:** [2026-05-26-title-pricing-tracking-design.md](./2026-05-26-title-pricing-tracking-design.md)
**Plan:** [2026-05-26-title-pricing-tracking.md](../plans/2026-05-26-title-pricing-tracking.md)

Run these steps in order against a fresh dev DB to verify the end-to-end flow works.

## Setup

- [ ] Reset DB and reseed:
  ```bash
  pnpm prisma migrate reset
  pnpm db:seed
  ```
- [ ] All migrations applied. Test suite green: `pnpm test` (expect 178+).

## Buyer-facing — "Contact for price" baseline

- [ ] Visit `/en/catalog` — every product should render "Contact for price" (no €/$ shown), because `confirmedAt = null` on all seeded products.
- [ ] Visit `/en/catalog/<some-slug>` — same: prices hidden, description + Contact CTA visible.
- [ ] Verify the desk banner — sign in as SUPERADMIN, visit `/en/desk` — banner reads "N products need price confirmation" with a link to `/desk/titles?freshness=never`.

## Sales contact + price request

- [ ] Sign in as SUPERADMIN. Visit `/en/desk/titles/<some-id>`.
- [ ] In the Sales contacts panel: add a new contact (use your own email). Mark "primary" on creation.
- [ ] In the Price requests panel: pick the new contact, click "Send request".
- [ ] In your terminal log, you should see `[email]` with the recipient address and "Price check: <title>" subject.
- [ ] Copy the magic link URL from the email log (or from `prisma studio` → PriceRequest table → token field).

## Magic-link form

- [ ] Open the magic link in an incognito window (no auth required).
- [ ] Page should show "Hi <name>" greeting and the form with each product.
- [ ] Fill in a price for at least one product. Add a note. Submit.
- [ ] You should land on `/<locale>/price-request/<token>/thanks`.
- [ ] Refresh the original magic link URL — should now show "Already received" instead of the form (single-use).

## Apply

- [ ] Back in `/en/desk/titles/<id>`, refresh.
- [ ] PendingQuotes panel should show one entry side-by-side ("Never confirmed" vs the new quote).
- [ ] Click "Apply". The quote should disappear from pending.
- [ ] Visit `/en/catalog/<slug>` — the product that was applied now shows its actual price.
- [ ] Desk banner count should have decreased by 1.

## Bulk

- [ ] Back at `/en/desk/titles`, select 2-3 titles via checkboxes.
- [ ] Click "Send price request to selected" in the toolbar.
- [ ] Email log should show one outbound message per title (or fewer if multiple titles share a primary contact — that's the dedup behavior).
- [ ] Titles without a primary contact should have been silently skipped.

## MCP

Requires an `ApiKey` with `pricing:admin` scope. To create one quickly, insert via Prisma Studio or a one-off seed script (the existing `/desk/api-keys` UI may or may not expose the new scope yet).

- [ ] Add the MCP server in Claude Code:
  ```bash
  claude mcp add native-local --transport http http://localhost:<port>/api/mcp --header "X-API-Key: <token>"
  claude mcp list
  ```
  Should show `native-local` connected.
- [ ] Run a read tool:
  ```
  /tools native_list_titles_needing_price_check {"olderThanDays": 90}
  ```
  Should return JSON of titles.
- [ ] Run a mutation tool (only if the key has `pricing:admin`):
  ```
  /tools native_create_price_request_bulk {"titleIds": ["<id1>", "<id2>"], "send": true}
  ```
  Should fire emails and return the created requests.

## Audit trail

- [ ] Check the `AuditLog` table — each desk-UI action and each MCP mutation should have a row with the correct actor (user ID for desk, `apikey:<id>` for MCP).
