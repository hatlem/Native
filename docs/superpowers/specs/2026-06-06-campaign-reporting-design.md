# Campaign reporting & end-of-campaign number collection — design

**Date:** 2026-06-06
**Status:** Approved (brainstorm) — pending spec review → implementation plan

## Problem

At the end of a campaign we need to collect performance numbers from each
publisher so we can report results back to the advertiser. Today the platform
has the raw materials (bookings, a publisher-reported `impressions` field,
first-party tracked links, an outreach engine) but no concept that ties a
campaign run-window, its publisher set, its tracking, and its end-of-campaign
number collection together into a reportable whole.

Specific needs the advertiser/desk raised:

1. Know when each campaign **starts and ends**. Some publishers keep the native
   article live after the paid-media flight ends, but the reported number must be
   tied to the **campaign window**, not the article's lifetime.
2. **Follow up with the publisher** at the end of the campaign to get the numbers,
   store them against the campaign, and report back to the advertiser.
3. **Connect tracking**: our first-party tracking links *and* capture the
   publisher's own tracking link when they have one.
4. **See all publishers** included in a campaign.

## Decisions (locked during brainstorm)

- **One Order = one campaign.** No new top-level Campaign entity. The Order is the
  campaign spine; publishers are its `INVENTORY` bookings.
- **Dates at three tiers:** `Plan.startDate/endDate` (buyer intent, already exists)
  → `Order.flightStartDate/flightEndDate` (actual paid flight) → per-booking
  `liveStartDate/liveEndDate` (actual run, may extend past the flight).
- **Number capture via three paths** into the same per-booking metrics row:
  tokenized self-serve form, AI-parsed email reply, desk manual override.
- **Metrics evolve** — typed columns for anything the report renders, a JSON bag
  for not-yet-promoted extras.
- **Freeze the campaign number at close**, and show live-to-date ("still earning")
  separately. The advertiser report is reproducible.
- **Tracking:** keep first-party `TrackedLink` (per line, click-counted) and add a
  stored publisher-provided tracking URL per booking; surface both per publisher.

## Non-goals (v1)

- A first-class Campaign entity spanning multiple Orders.
- A dated click-events table (windowed first-party clicks). `clickCount` stays a
  running counter; we snapshot it at close for reproducibility.
- Multiple publisher tracking URLs per booking (scalar field for now; promote to a
  child table only if publishers commonly send several).
- Post-flight lifetime tracking of *publisher-reported* numbers beyond the latest
  reading + the frozen snapshot.
- Building the AI email *reader/extractor* — that exists on the operator side
  (GetMailer inbox + AI). We build the **attribution + write-into-metrics** wiring.

---

## Data model

### `Order` (the campaign)

Add:

| field | type | notes |
|---|---|---|
| `flightStartDate` | `DateTime?` | actual paid-media flight start; defaulted from `Plan.startDate` on order creation |
| `flightEndDate` | `DateTime?` | actual flight end; drives the report window + follow-up scan; defaulted from `Plan.endDate` |

### `PublisherBooking`

Add:

| field | type | notes |
|---|---|---|
| `publisherId` | `String` + relation, `@@index` | **denormalized at booking creation** (backfilled in migration via `orderLine.product.title.publisherId`). The publisher anchor everything else relies on. |
| `titleId` | `String` + relation, `@@index` | denormalized for report grouping |
| `liveStartDate` | `DateTime?` | actual article go-live |
| `liveEndDate` | `DateTime?` | actual article end; may extend past `Order.flightEndDate` |
| `publisherTrackingUrl` | `String?` | publisher's own tracking link (scalar, v1) |

Rationale for denormalization: a publisher is otherwise reachable only via
`OrderLine.productId → Product.title.publisherId`, and `productId` is **nullable**
(null for `CONTENT_FEE` lines). The denormalized field mirrors the existing
`countryCode` denormalization on `Title`/`Publisher` ("so catalog filtering can hit
an index without joining").

### `BookingMetrics`

Keep one row per booking (`bookingId @unique`). Split *live-to-date* from the
*frozen campaign number*:

**Latest reported (mutable, "still earning"):**

| field | type | notes |
|---|---|---|
| `impressions` | `Int?` | core reach |
| `pageViews` | `Int?` | |
| `publisherReportedClicks` | `Int?` | **named distinctly** from first-party clicks to avoid report collision |
| `avgTimeSec` | `Int?` | |
| `scrollDepthPct` | `Int?` | |
| `extra` | `Json?` | **only** not-yet-promoted extras; never anything the report renders as a column |
| `windowStart` / `windowEnd` | `DateTime?` | which window this reading covers |

**Frozen snapshot (the deliverable):**

| field | type | notes |
|---|---|---|
| `frozenAt` | `DateTime?` | set at close; once set, snapshot columns are immutable |
| `impressionsAtClose` | `Int?` | campaign impressions snapshot |
| `clicksFirstPartyAtClose` | `Int?` | live `TrackedLink.clickCount` sum at the instant of freeze (counter keeps running afterward) |

**Provenance:**

| field | type | notes |
|---|---|---|
| `source` | `MetricsSource` | extended enum (below) |
| `reportedAt` | `DateTime?` | |
| `reportedBy` | `String?` | e.g. user id, or `email:<msgid>` for AI path |
| `note` | `String?` | for the AI path, stores the **raw quoted email snippet** the number was extracted from, so the desk can audit |

All publisher-reported numbers — form *and* email — are authoritative and render
in the advertiser report; the AI email path is just transcribing what the
publisher stated. `source` carries provenance for display/audit, not a gate.

Store-layer precedence on write (tie-break only): **DESK > PUBLISHER_FORM >
PUBLISHER_EMAIL.** A desk override wins (corrects a mis-parse); otherwise the
latest reported value stands.

### `MetricsRequest` (new — mirrors `RateCardRequest`)

| field | type | notes |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `orderId` | `String` + relation | `@@index` |
| `publisherId` | `String` + relation | the denormalized anchor |
| `recipientEmail` | `String?` | **frozen at creation** from `SalesContactTitle` (prefer `isPrimary`) |
| `recipientName` | `String?` | |
| `token` | `String @unique` | plain (not hashed), via shared token helper |
| `status` | `MetricsRequestStatus` | enum below |
| `sentCount` | `Int @default(0)` | reuses `sequence.ts` cadence |
| `lastStepAt` | `DateTime?` | |
| `nextStepAt` | `DateTime?` | |
| `sentAt` | `DateTime?` | |
| `respondedAt` | `DateTime?` | |
| `completedAt` | `DateTime?` | |
| `cancelledAt` | `DateTime?` | |
| `expiresAt` | `DateTime` | |
| | | `@@unique([orderId, publisherId])` — makes scan + manual resend idempotent |

### `MetricsRequestBooking` (new join — mirrors `RateCardRequestTitle`)

| field | type | notes |
|---|---|---|
| `metricsRequestId` | `String` + relation `onDelete: Cascade` | |
| `bookingId` | `String` + relation `onDelete: Cascade` | `@@index([bookingId])` |
| | | `@@id([metricsRequestId, bookingId])` |

Enumerates exactly which bookings a token collects — handles a publisher with
multiple placements in one order without re-deriving scope per render.

### Enums

```
enum MetricsSource {
  PUBLISHER_FORM    // tokenized self-serve form (publisher typed it)
  PUBLISHER_EMAIL   // AI-transcribed from a publisher email reply (authoritative; raw snippet kept in note)
  DESK              // manual entry / override
}
// Migration: keep DESK; rename old PUBLISHER → PUBLISHER_FORM; add PUBLISHER_EMAIL.

enum MetricsRequestStatus {
  NEEDS_CONTACT   // no resolvable contact — surfaced to desk, not sent
  PENDING         // created, awaiting first/next send or response
  PARTIAL         // some bookings reported
  COMPLETE        // every booking in the join has impressions present
  EXPIRED         // max reminders reached / past expiry with no response
  CANCELLED
}
```

`COMPLETE` = every booking in the request's `MetricsRequestBooking` join has a
`BookingMetrics` row with non-null `impressions`. `PARTIAL` = some-but-not-all.
This avoids "never COMPLETE" against an open-ended metric set.

---

## Collection flow

### 1. Daily scan — `scripts/build-metrics-campaign.ts`

Mirrors `scripts/build-rate-card-campaign.ts`. Idempotent; safe to run repeatedly.

- Select Orders where: `status` ∉ `{CANCELLED}` (and is a fulfilled/live state),
  `flightEndDate` is set, and `now() > flightEndDate + grace`.
  - **Grace / timezone:** require past `flightEndDate` end-of-day **+ 1 day** so we
    never email "campaign's over" while it's still running in a later timezone
    (markets span NO/SE/DK/FI/DE/AT/CH/UK/IE).
- For each order, group its **non-cancelled `INVENTORY` bookings by `publisherId`**.
  - `CONTENT_FEE`-only orders have no bookings → skipped naturally.
  - Cancelled bookings excluded from the publisher set.
- For each (order, publisher) group with no existing `MetricsRequest`
  (`@@unique([orderId, publisherId])` guarantees no duplicates):
  - Resolve recipient via `SalesContactTitle` for the publisher's titles in this
    order (prefer `isPrimary`, then deterministic fallback).
  - Create `MetricsRequest` + `MetricsRequestBooking` rows; freeze
    `recipientEmail`/`recipientName`.
  - **No contact resolves → `status = NEEDS_CONTACT`** (surfaced to desk; not sent).
  - `recordAudit` on creation (matches `buildRateCardCampaign`).

**Trigger:** a real cron (Railway scheduled job / platform cron) hitting an
idempotent ops endpoint that runs the scan + send. *Not* `jobs.ts` — `enqueue`
fires immediately and ignores `runAt`, and there is no worker loop in the repo.
The rate-card outreach this clones is already driven by a daily operator-run
`tsx` script; we follow that proven pattern.

### 2. Send + reminders — `scripts/send-metrics-batch.ts`

Mirrors `scripts/send-rate-card-batch.ts`; `sendMetricsRequestStep` is a structural
clone of `sendRateCardStep`.

- Batch query reuses the `sentCount < MAX_STEPS && (sentCount == 0 || nextStepAt <= now())`
  cadence from `sequence.ts` / `selectBatchForSend`.
- Per-send guards: skip responded / complete / cancelled / expired / max-steps;
  **rate-limit** via `outreachLimiter`; **suppression**:
  - block hard-`bounce` (dead address — protects domain reputation),
  - **allow through a marketing `unsubscribe`** (this is a transactional follow-up
    on an order the publisher actively fulfilled). Branch on
    `OutreachSuppression.reason`.
- **Token correlation:** the email carries the token in (a) the form link, and
  (b) a per-request `metrics+<token>@…` reply-to (plus `[ref: <token>]` in the
  body). This lets an inbound reply be attributed to the exact request → bookings.
- Send via `emailAdapter` / `@/lib/notify`; bump `sentCount`/`lastStepAt`/
  `nextStepAt`; `recordAudit`.

### 3. Three feed-in paths → same per-booking `BookingMetrics`

Precedence DESK > PUBLISHER_FORM > PUBLISHER_EMAIL.

**(a) Self-serve form — `/[locale]/campaign-report/[token]`**
No-login route mirroring `rate-card/[token]` (page + actions). Token verdict
(expired/responded/cancelled) + rate-limit via the shared helper. Renders one
block per booking from `MetricsRequestBooking`; each block upserts its own
`BookingMetrics` (`source = PUBLISHER_FORM`). On submit: bump sequence timestamps,
set `respondedAt`, recompute `status`.

**(b) AI email reply**
Operator-side AI reads/extracts (exists). New wiring: match reply → token (from
reply-to / subject / threading) → `MetricsRequest` → its bookings; write
`BookingMetrics` (`source = PUBLISHER_EMAIL`, `reportedBy = 'email:<msgid>'`,
`note` = the raw quoted snippet); also drop a `ContactLog` (audit). These numbers
**render in the advertiser report** like any publisher-reported value.
**Idempotency** on `(requestId, msgid)` so webhook retries / re-runs are no-ops.
If the publisher has **multiple placements** and the reply can't be attributed to
a specific booking, flag for desk rather than guessing.

**(c) Desk manual / override**
On the desk order page, per booking; `source = DESK`. Always wins (corrects a
mis-parse or fills a gap).

### 4. Freeze

When a request reaches `COMPLETE` (or unconditionally at `flightEndDate + grace`),
snapshot per booking: set `frozenAt`, `impressionsAtClose` (current impressions),
`clicksFirstPartyAtClose` (live `TrackedLink.clickCount` sum at that instant).
Live-to-date fields keep updating afterward; the snapshot is immutable and is what
the advertiser report renders.

---

## Surfaces

### A. Desk order page (`desk/orders/[orderId]/page.tsx`)

Broaden the query (currently brief/assets/trackedLinks/writerPool only) to include
`lines.booking.metrics`, resolve publisher per line (now a direct field), call
`clicksByOrderLine`.

New **Campaign** section:
- Flight window (`flightStartDate`/`flightEndDate`) — desk-editable, defaulted from Plan.
- Grouped **by publisher → per-booking rows**: publisher/title, `liveStartDate`/
  `liveEndDate`, `liveUrl`, our tracking link + live clicks, `publisherTrackingUrl`,
  reported numbers with a `source` badge (form / email / desk) + the raw email
  snippet on hover for the email path, frozen values once `frozenAt` is set.
- Per-publisher collection status (`MetricsRequest.status`).
- Actions: **resend** (reuses token, bumps `sentCount`, never mints a new request);
  manual entry / **override** (DESK, wins over a mis-parse); edit flight/live dates
  + publisher tracking URL; "add contact → send" for a `NEEDS_CONTACT` request;
  resolve a flagged multi-placement attribution.

Desk-wide **`NEEDS_CONTACT` queue** (orders list or desk reports) so unresolved
publishers don't rot.

### B. Advertiser campaign report

A "Campaign report" section on the buyer's `orders/[orderId]` page:
- **`scopeOrgIds`-gated.** Never exposes `unitCost`/`marginPct`/`revenueSplit`.
- Flight window; **all publishers in the campaign**; per-publisher **frozen** numbers
  (impressions-at-close, first-party clicks-at-close); **CTR per publisher** over
  bookings with non-null impressions + a coverage caveat ("CTR for N of M publishers
  who reported reach"); campaign totals in the single Quote currency; every metric
  **labelled with its window**, with a separate clearly-labelled "still earning"
  live-to-date figure (honest longevity claim; matches the existing reach
  disclaimer — first-party clicks; reach reported by publisher where available; no
  viewability claim).
- All publisher-reported numbers render (form + email + desk), with a small
  provenance indicator.
- **CSV export** via `src/lib/csv.ts` (OWASP injection guard) + a route mirroring
  `api/export/invoices.csv` (auth gate, `Content-Disposition`, `recordAudit`).
  Typed columns: publisher, title, liveStartDate, liveEndDate, impressions,
  firstPartyClicks, pageViews, avgTimeSec, scrollDepthPct, ctr, window.
- New pure helper `ctrPct(clicks, impressions)` in `reporting.ts` (sibling of
  `conversionPct`).

### C. i18n

Strings authored in `en.json` first, then no/da/sv/fi/de (source-language
standard). Covers the form, desk section, report, and follow-up email templates.

---

## Edge cases & guards

| case | handling |
|---|---|
| `CONTENT_FEE`-only order | no bookings → no `MetricsRequest`; not rescanned forever |
| Cancelled order | excluded from scan (`status` filter) |
| Cancelled booking on a live order | excluded from the publisher set |
| Publisher with multiple placements in one order | one request, N booking blocks via the join; `COMPLETE` requires all N; report sums per booking, no double-count |
| No / multiple contacts for a publisher | resolve via `SalesContactTitle` (prefer `isPrimary`); none → `NEEDS_CONTACT` |
| Timezone / date boundary | scan requires `flightEndDate` end-of-day + 1-day grace |
| `flightEndDate` edited after send | PENDING → update window/`dueAt`; already COMPLETE & window moved materially → flag for desk review (idempotency key includes the window value) |
| Publisher reports before flight end | logged-in publisher can already write metrics anytime; `reportedAt` recorded; campaign number is the reading within/closest to the window, frozen at close |
| Re-send / concurrent scan + manual resend | `@@unique([orderId, publisherId])`; resend reuses token; send job idempotent on `(requestId, kind)` |
| Same number via two paths | single row per booking + precedence rule; AI path idempotent on `(requestId, msgid)` |
| Suppressed recipient | block hard-bounce; allow marketing-unsubscribe (transactional) |
| First-party clicks keep accruing | `clicksFirstPartyAtClose` snapshot makes the deliverable reproducible; live-to-date shown separately |

---

## Reuse map (do not reinvent)

- `RateCardRequest` / `RateCardRequestTitle` → `MetricsRequest` / `MetricsRequestBooking` shape.
- `src/lib/outreach/campaign.ts` (`buildRateCardCampaign`, `sendRateCardStep`,
  `selectBatchForSend`) → metrics build/send orchestration.
- `src/lib/outreach/sequence.ts` → reminder cadence (via the shared `sentCount`/
  `nextStepAt` fields).
- `src/lib/outreach/suppression.ts` (`isSuppressed`) → send guard.
- Shared **request-token helper** — extract one module from the duplicated
  `outreach/tokens.ts` + `pricing/tokens.ts`; consume in rate-card, price-request,
  and campaign-report. Token stays plain-unique.
- `rate-card/[token]/{page,actions}.tsx` → `campaign-report/[token]` shape.
- `src/lib/metrics/store.ts` (`clicksByOrderLine`) → first-party click sums.
- `src/lib/reporting.ts` → add pure `ctrPct`; keep per-currency discipline.
- `src/lib/csv.ts` + `api/export/invoices.csv/route.ts` → export.
- `recordAudit` throughout.

---

## Testing

- **Unit:** `ctrPct` (incl. zero/null denominators); `COMPLETE`/`PARTIAL` derivation;
  freeze snapshot logic; precedence on write; suppression branching by reason;
  scan eligibility (flight end + grace, status, CONTENT_FEE-only, cancelled).
- **Integration:** scan creates exactly one request per (order, publisher),
  idempotent on re-run; `NEEDS_CONTACT` when no contact; multi-placement publisher
  → one request, N booking blocks; form submit writes per-booking metrics + updates
  status; AI-path idempotency on `(requestId, msgid)`; desk override beats AI.
- **E2E:** publisher opens token form, submits numbers per placement → advertiser
  report shows frozen numbers + CTR with coverage caveat; CSV export gated + audited.

## Migration

1. Add `flightStart/EndDate` to `Order`; backfill from `Plan` where present.
2. Add `publisherId`/`titleId`/`liveStart/EndDate`/`publisherTrackingUrl` to
   `PublisherBooking`; **backfill `publisherId`/`titleId`** from the product chain.
3. Extend `BookingMetrics` (additive columns + `frozenAt`/`*AtClose`, keep `note`,
   `source` enum change). Migrate existing `source` values → `PUBLISHER_FORM`.
4. Create `MetricsRequest`, `MetricsRequestBooking`, the two new enums.
5. Set `publisherId`/`titleId` at booking creation in `firm-order.ts` going forward.

(Note: `prisma migrate dev` is blocked in this env per project memory — author the
migration SQL to run on deploy, consistent with the existing migration set.)
