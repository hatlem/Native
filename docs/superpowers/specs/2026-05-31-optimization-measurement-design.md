# Optimization — Real Performance Measurement — Design Spec

**Date:** 2026-05-31
**Status:** Approved (design); pending spec review
**Sub-project:** 4 of 5 in the SUNT-gap competitive build

## Context

A competitive audit of suntcontent.com surfaced "optimization" (A/B testing,
conversion tracking). NativeSpin is a managed/RFQ marketplace; **publishers
serve the content on their own sites**, so NativeSpin cannot run pixels or
measure viewability/scroll-depth itself.

**Critical finding (verified):** the product *already promises* performance data
it cannot deliver — `quoteNarrative.bullets.NATIVE_DISPLAY` says "Performance
report at 30 and 90 days (impressions, click-through, viewability)" and the
measurement Q&A promises "page views, time on page, scroll depth … brand lift
… panel study." None of this is collected anywhere; there is no metrics table,
no publisher intake, no tracking link. This is a live false claim.

This sub-project turns the promise into something **true** and removes what we
can't honor. Decisions locked during brainstorming:

- **PRIMARY: in-article tracked links (REVISED — supersedes booking-level
  clickToken below).** NativeSpin produces the article content (`ContentAsset`),
  so it owns every outbound link in the article. When generating/finalizing an
  article the desk/writer **chooses which destination URL(s) to track**; the
  system mints a `/go/<token>` link, embeds it in the article body in place of
  the raw URL, and counts first-party clicks per link. Works for ALL formats
  (native article included), not just display CTAs — clicks become real and
  ours, no publisher self-reporting needed. Many `TrackedLink`s per order line.
- **Impressions:** kept as an OPTIONAL publisher/desk-entered number for
  reach-delivered context. Clicks (from tracked links) are the primary, always-
  shown metric; impressions show when provided.
- **Dashboard:** buyer (and desk) see per-article click counts (sum of its
  tracked links), per-link breakdown, optional impressions, reported date.
- **Copy:** reword to what we deliver; drop viewability / scroll-depth /
  brand-lift-panel claims entirely.

### REVISED data model (replaces §1 booking-level clickToken)

```prisma
model TrackedLink {
  id          String   @id @default(cuid())
  orderLineId String                       // the placement this link belongs to
  orderLine   OrderLine @relation(fields: [orderLineId], references: [id], onDelete: Cascade)
  token       String   @unique             // unguessable base64url; the /go/<token> slug
  targetUrl   String                       // advertiser destination
  label       String?                      // e.g. "CTA", "product link"
  clickCount  Int      @default(0)
  createdAt   DateTime @default(now())
  @@index([orderLineId])
}
```

`BookingMetrics` is kept but slimmed to `impressions Int?` + report metadata
(no `clicks`/`linkClicks` — clicks now come from `TrackedLink`). The
`PublisherBooking.clickToken`/`clickTargetUrl` fields from the original §1 are
**dropped** in favour of `TrackedLink`.

Flow: in the content-production UI (where the desk/writer finalizes a
`ContentAsset` for an order line), a "tracked links" panel lets them add
destination URLs + labels → each becomes a `TrackedLink` and shows its
`/go/<token>` to paste into the article body. `GET /go/<token>` increments
`clickCount` and 302-redirects to `targetUrl` (bad token → safe fallback, no
500, no PII). Buyer/desk dashboard aggregates clicks per order line.

> NOTE: the §1 below (PublisherBooking.clickToken, CTA-only minting) is the
> earlier approach and is SUPERSEDED by this section — implement the
> TrackedLink model above instead.
- **A/B testing: explicitly OUT OF SCOPE** (deferred) — splitting delivery is
  premature before we can even measure one variant; revisit once real metrics
  exist.

## Grounding (current state, verified)

- `PublisherBooking` (`prisma/schema.prisma`): `status`, `placementDate`,
  `liveUrl`, `confirmedAt` — **no metric fields**.
- Publisher portal (`src/app/[locale]/publisher/orders/page.tsx`): publisher can
  set booking status + `liveUrl`; no metrics form.
- Desk reports (`src/app/[locale]/desk/reports/page.tsx`): platform KPIs only
  (request/order counts, conversion %, GMV) — no per-campaign performance.
- Analytics: GTM consent scaffold only (`src/app/gtm.tsx`,
  `src/app/data-layer-event.tsx`) — site-wide, not per-campaign.
- False-claim copy lives in `src/messages/{locale}.json` — `quoteNarrative`
  bullets and the advertiser/landing measurement Q&A.

## 1. Schema (additive migration)

New model `BookingMetrics` (1:1 with `PublisherBooking`):

```prisma
enum MetricsSource {
  PUBLISHER
  DESK
}

model BookingMetrics {
  id          String        @id @default(cuid())
  bookingId   String        @unique
  booking     PublisherBooking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  // Publisher-reported figures from their own analytics. Nullable — absence
  // means "not yet reported", which the buyer view renders as a pending state.
  impressions Int?
  clicks      Int?
  // First-party clicks counted by our own /go/<token> redirect. Independent
  // of the publisher-reported `clicks`. Starts at 0, only grows.
  linkClicks  Int           @default(0)
  source      MetricsSource @default(PUBLISHER)
  note        String?
  reportedAt  DateTime?     // set when impressions/clicks first entered
  reportedBy  String?       // userId or "system"
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}
```

Add to `PublisherBooking`:

```prisma
  // Advertiser destination for the tracked click link (where /go/<token>
  // redirects). Set by desk/publisher when the placement has an outbound CTA.
  clickTargetUrl String?
  // First-party tracked-link token, minted only for bookings whose product
  // type carries an outbound CTA (NATIVE_DISPLAY, NATIVE_PLUS, CONTENT_VIDEO).
  // Null for pure native-article placements. Unique; raw value is the URL slug.
  clickToken     String?  @unique
  metrics        BookingMetrics?
```

One additive migration (`CREATE TYPE MetricsSource`, `CREATE TABLE`,
`ALTER TABLE PublisherBooking ADD COLUMN` ×2, indexes), applied via
`prisma db execute` + `prisma migrate resolve --applied` + `prisma generate`
(migrate dev is blocked for the agent). Timestamp sorts after
`20260531130000_add_title_geo_and_plan_targeting`.

## 2. Tracked click link

- `GET /go/<token>` route handler (`src/app/go/[token]/route.ts`, outside the
  `[locale]` tree so it has no locale prefix, like `/api`).
- Pure resolver `resolveClick(token)` → `{ targetUrl } | null` lives in
  `src/lib/metrics/click.ts` and is unit-tested; the route does the lookup,
  atomically increments `BookingMetrics.linkClicks` (upserting a metrics row if
  none exists yet), and 302-redirects to `clickTargetUrl`.
- Unknown/expired token or missing target → redirect to a safe fallback (the
  booking's `liveUrl` if present, else the marketplace home). **Never a 500, no
  PII in the URL.**
- Token minted by `mintClickToken()` (from `@/lib/tokens` pattern) when a
  booking is created/confirmed for a CTA-bearing product type. A pure helper
  `productTypeHasCta(type)` decides eligibility (NATIVE_DISPLAY, NATIVE_PLUS,
  CONTENT_VIDEO → true; else false) and is unit-tested.

## 3. Entry + display

- **Publisher portal** (`/publisher/orders`): for each LIVE booking, a small
  metrics form (impressions, clicks) writing `BookingMetrics` with
  `source = PUBLISHER`; shows the `/go/<token>` link to use as the CTA target
  and the destination URL field. Server action `submitBookingMetrics`,
  validated (non-negative integers).
- **Desk**: can edit any booking's metrics (`source = DESK`, `reportedBy` =
  desk user); reuses the same validated action with an authority check.
- **Buyer** (order/reports view): read-only performance panel per order line —
  impressions, click-through (publisher clicks and first-party link clicks),
  reported date. Empty state copy: "Reporting at the agreed checkpoint."

## 4. Honest copy fix (all six locales)

- Rewrite `quoteNarrative.bullets.*` performance bullet to: "Performance
  check-in at agreed checkpoints: publisher-reported impressions and
  click-through, plus first-party clicks on tracked links." Remove
  "viewability".
- Rewrite the measurement Q&A (`advertisers`/`landing`) to the same real
  deliverable; **delete** scroll-depth, time-on-page, and brand-lift-panel
  promises.
- Any marketing "reporting" line updated to match. en first, then
  no/sv/da/fi/de, parity-checked.

## 5. Testing & verification

- node:test (pure): `productTypeHasCta`, `resolveClick` (valid token → target,
  bad token → null), metrics validation (reject negatives / non-integers).
- DB-glue (store, action, route) verified by `pnpm typecheck` + `pnpm build`
  (no prisma-mock infra; matches repo convention).
- i18n parity script for the reworded keys across six locales.
- Manual smoke: enter metrics as publisher → buyer view shows them; hit
  `/go/<token>` → redirects + increments; bad token → safe fallback.

## Out of scope

A/B / split delivery (deferred — needs a metrics baseline first). Real-time
pixels / viewability / scroll-depth / brand-lift (uncollectable in this model —
removed from copy). Programmatic buying (sub-project 5).
