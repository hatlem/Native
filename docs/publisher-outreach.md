# Publisher Rate-Card Outreach — Operator Runbook

How the system that contacts publishers for rate cards works, and how to run it.

- **Design spec:** `docs/superpowers/specs/2026-05-28-publisher-rate-card-outreach-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-05-28-publisher-rate-card-outreach.md`

## What it does

Reaches the ~800 publishers in the catalog with a price request framed as a real
advertiser inquiry ("we have an advertiser we'd like to check prices for"), captures
the responses, and ends up with quotable native/advertorial inventory across the 9
markets (NO/SE/DK/FI/DE/AT/CH/UK/IE).

Three sub-systems:

- **A — Discovery:** scrape publisher websites for ad-sales contact emails, review them
  in an admin UI, approve the good ones into `SalesContact` rows.
- **B — Outreach:** group contacts by email (so a sales house that sells for 90 titles
  gets one email, not 90), send a 3-step sequence, throttled.
- **C — Response:** a tokenised page where publishers can upload a rate card, paste a
  URL, or enter prices per title. Reply-first: most will just reply to the email.

## The workflow (end to end)

All scripts read `DATABASE_URL`. Run them against production with the public DB proxy
URL (Railway → Postgres service → `DATABASE_PUBLIC_URL`), or on Railway directly.

```bash
# 1. Scrape contact candidates from publisher websites (safe, no email sent)
pnpm scrape-contacts
#    → upserts ContactCandidate rows (status PENDING). Re-runnable; skips publishers
#      that already have an APPROVED candidate. ~30-60 min for the full list.

# 2. Review candidates in the admin UI (superadmin only)
#    /desk/publisher-contacts
#    - Approve / Edit & Approve / Reject each, or "Bulk-approve confidence >= 80"
#    - Approving creates a SalesContact and attaches it to all the publisher's titles

# 3. Build the campaign (groups approved contacts by email)
pnpm build-rate-card-campaign --dry-run    # inspect counts first
pnpm build-rate-card-campaign              # creates RateCardRequest rows

# 4. Send a batch (throttled; respects daily/hourly caps + suppression)
pnpm send-rate-card-batch --dry-run --limit=20   # see what would send
pnpm send-rate-card-batch --limit=20             # send the initial 20

#    Run step 4 once per day. It picks up never-sent requests AND requests whose
#    next sequence step is due (bump1 +5 days, bump2 +12 days).
```

The "Campaign" tab on `/desk/publisher-contacts` mirrors steps 3–4 with buttons
(Build / refresh, Send batch, per-row Send) for non-CLI operation.

## The email sequence

One recipient = one email thread = one token, regardless of how many titles they cover.

| Step | When | Content |
|------|------|---------|
| `initial` | day 0 | Advertiser inquiry + title list + reply-first CTA. No opt-out. |
| `bump1` | day +5 (if no response) | Short reminder. No opt-out. |
| `bump2` | day +12 (if no response) | Breakaway: "right person? / not interested?" — **only this email carries List-Unsubscribe + an opt-out link.** |

Sequence stops immediately on response, cancel, or suppression.

**Why no opt-out on the first two:** unsubscribing on a "send us prices so we can sell
your inventory" email is self-defeating — the publisher loses sales to our advertisers.
At ≤20/day we're well below the bulk-sender threshold that would mandate List-Unsubscribe
on every message. The breakaway (bump2) still offers a clean exit.

Copy lives in `src/lib/outreach/email.ts` (6 locales × 3 steps). Norwegian uses
"annonsørinnhold" (the industry term); other locales use "advertorial". Signature is
"Elias Getia, NativeSpin".

## The response page

`/<locale>/rate-card/<token>` — public, token-gated, no login. Three ways to respond:

1. **Upload** a rate card / media kit (PDF/PPTX/image, ≤25 MB) → stored in Cloudflare R2.
2. **Paste a URL** to an external rate card.
3. **Enter prices per title** — native pricing is two-part:
   - **Production** (one-time: the publisher's studio writes/produces the article/video)
   - **Distribution** (CPM / flat campaign / per-click / guaranteed reach)
   - Currency defaults to the market currency (NOK for NO titles).

Plus: which formats they offer, and **who writes the content** (advertiser can deliver
their own articles / must be written by the publisher's department / both).

The "prices are indicative, final offer negotiated on volume" disclaimer lives on the
**buyer-facing** title page (`/catalog/[slug]`), not on this form.

Responses land on the `RateCardRequest` row (`responseData` JSON, `mediaKitObjectKey`,
etc.) with `respondedAt` set. The desk reads them and transcribes to quotable prices.

## Sending infrastructure

- **Provider:** Resend (`RESEND_API_KEY`). Domain `nativespin.com` is verified
  (SPF/DKIM/DMARC).
- **From / Reply-To:** `OUTREACH_FROM` and `OUTREACH_REPLY_TO` (Railway env). Currently
  `Elias Getia <elias@nativespin.com>` — a personal 1:1 sender to stay out of Gmail's
  Promotions tab.
- **Adapter:** `src/lib/mail/resend.ts`. Honors per-message `from` / `replyTo` overrides
  so outreach mail is separate from transactional auth mail (`AUTH_EMAIL_FROM`).
- **Throttle:** `outreachLimiter` (8/hour) + `OUTREACH_DAILY_CAP` (20) + `OUTREACH_HOURLY_CAP` (8).

## Receiving replies — wired via GetMailer

Replies (and any mail to `@nativespin.com`) are received by **GetMailer** (the team's own
ESP) and read through GetMailer's inbox API / MCP. Current setup:

- `nativespin.com` is added + **verified** in GetMailer (account key in
  `~/.claude/settings.json` → `GETMAILER_API_KEY`). Inbound is enabled; `elias@nativespin.com`
  is a registered inbound address.
- DNS: `nativespin.com MX 10 mail.getmailer.co` (Cloudflare). This is GetMailer's MTA — the
  same MX `getmailer.co` and other GetMailer domains use.
- **Resend sending is untouched** — it lives on the `send.nativespin.com` subdomain
  (`feedback-smtp...amazonses.com` + `resend._domainkey`), independent of the apex MX.
- Cloudflare Email Routing is **disabled** (an earlier Gmail-forwarding attempt was removed)
  — the apex MX points only at GetMailer.

**Reading replies:**
- The `getmailer` MCP (configured in `~/.claude/settings.json`) reads the inbox, but loads
  only on Claude Code **restart** — not mid-session.
- Or call the API directly: `GET https://getmailer.co/api/inbox` with
  `Authorization: Bearer $GETMAILER_API_KEY`.

When a reply arrives, the desk marks the matching `RateCardRequest` responded
(`responseSource: "EMAIL"`) and records the prices.

> Note: GetMailer's spam filter quarantines by default (threshold 5). If a legitimate reply
> doesn't show in the main inbox, check `?status=QUARANTINED`.

**To re-point replies elsewhere** (e.g. a Google Workspace mailbox), change the apex MX in
Cloudflare. Only one MX target can be active at a time.

## Environment variables (Railway)

```
OUTREACH_FROM="Elias Getia <elias@nativespin.com>"
OUTREACH_REPLY_TO=elias@nativespin.com
OUTREACH_DAILY_CAP=20
OUTREACH_HOURLY_CAP=8
RESEND_API_KEY=...                # already set (shared with transactional mail)
R2_ACCOUNT_ID=...                 # Cloudflare R2 (rate-card uploads)
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=nativespin-blob
```

## Data model

- `ContactCandidate` — scraper output awaiting review (PENDING/APPROVED/REJECTED).
- `SalesContact` (existing) — approved contact, attached to titles.
- `RateCardRequest` — one per recipient email; carries token, sequence state
  (`sentCount`, `nextStepAt`), and the response payload.
- `RateCardRequestTitle` — join: which titles a request covers.
- `OutreachSuppression` — opt-out / bounce / manual exclusion list.

## Safe re-runs & idempotency

- `scrape-contacts` upserts on `(publisherId, email)` — safe to re-run.
- `build-rate-card-campaign` skips emails that already have an active or responded
  request — safe to re-run.
- `send-rate-card-batch` only sends due steps; a responded/cancelled/suppressed
  recipient is skipped.

## Observability

Audit events (in the audit log): `candidate.approve`, `candidate.reject`,
`rate_card_request.create`, `rate_card_request.send.{initial,bump1,bump2}`,
`rate_card.submit`, `outreach.unsubscribe`, `outreach.skipped_suppressed`.
Delivery / bounce / complaint metrics: Resend dashboard.
