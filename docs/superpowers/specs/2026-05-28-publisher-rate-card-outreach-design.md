# Publisher Rate-Card Outreach — Design

**Status:** approved design (sub-systems A + B + C). D (pipeline-status-UI) deferred.
**Author:** brainstormed with Andreas, 2026-05-28
**Implementation order:** A → B → C, but all three are in scope for this spec.

## Goal

Reach all ~800 publishers in the seeded catalog with a rate-card request, capture the responses, and end up with quotable Native inventory across NO/SE/DK/FI/DE/AT/CH/UK/IE — without burning the sender domain's deliverability or violating GDPR.

The campaign frames the ask as buyer-pipeline-driven (we have advertisers looking for native inventory; we need current rates so we're ready when they ask), not as a marketplace-onboarding pitch.

## Scope decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | One email per recipient, not per title | 91 emails to Bonnier looks like spam and burns deliverability. Group by recipient email, list covered titles in the body. |
| 2 | Sales-house dedup happens on normalised recipient email, not via a SalesHouse model | Existing `SalesContact.publisherId` schema preserved. Group at campaign-build time. Avoids a schema-level abstraction we don't need yet. |
| 3 | Scraping (cheerio + fetch) is the primary email-discovery channel | Nordic media sites are mostly server-rendered HTML with explicit "Annonsere" pages. Apollo/Hunter has poor coverage for small regional papers. |
| 4 | Manual batch CLI for the scraper, not an admin-UI trigger | One-shot job; review happens in admin UI after. Lower complexity. |
| 5 | Tokenised response page (mirror of `/price-request/[token]`) | Reuses existing token/lifecycle pattern. No inbound-email webhook in v1. |
| 6 | 20 emails/day cap, 3-step sequence (day 0, +5, +12) | Cold-outreach best practice for unwarmed-ish domain. Sustainable; full list in ~37 working days. |
| 7 | PDF/PPTX upload via Cloudflare R2 | R2 wasn't configured before — we add a generic `lib/storage/r2.ts` helper usable for future media (placement-illustration images, etc.). |
| 8 | No auto-mapping from response → PriceQuote | Desk transcribes manually in v1. `responseData` is stored as JSON; can be normalised to a table later if reporting is needed. |
| 9 | D (pipeline-status-UI) deferred | A+B+C delivers the working pipeline. D is the eventual operator view — design it after we see what the data actually looks like. |

## Reused building blocks (no new code needed)

- `lib/pricing/contacts.ts`: `createSalesContact`, `attachContactToTitle`, `setPrimaryContact`, `normaliseEmail`, `listContactsForPublisher`
- `lib/pricing/tokens.ts`: token generation, `expiryFromNow`, `checkRequest`-style verdicts
- `lib/pricing/email.ts`: `localeForMarketCode`, per-locale email builder pattern
- `lib/notify.ts`: `emailAdapter` abstraction
- `lib/mail/resend.ts`: Resend SDK adapter
- `lib/rate-limit.ts`: `RateLimiter` class, `rfqLimiter`
- `lib/audit.ts`: `recordAudit`
- Auth: `requireDesk` / `requireSuperadmin` (from `desk-actions.ts`)
- Response-page pattern: `src/app/[locale]/price-request/[token]/{page,actions,thanks}.tsx`

---

## Data model

Four new models + two enums. Migration adds them in one step.

```prisma
// Sub-system A: scraper output, awaiting admin review
model ContactCandidate {
  id             String          @id @default(cuid())
  publisherId    String
  publisher      Publisher       @relation(fields: [publisherId], references: [id], onDelete: Cascade)
  email          String
  name           String?
  role           String?
  phone          String?
  sourceUrl      String
  confidence     Int             // 0-100
  status         CandidateStatus @default(PENDING)
  reviewedById   String?
  reviewedAt     DateTime?
  salesContactId String?         // set on approval
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  @@unique([publisherId, email])
  @@index([status])
}

enum CandidateStatus { PENDING APPROVED REJECTED }

// Sub-system B + C: one row = one recipient = one campaign thread = one token.
// Spans potentially many titles across many publishers (sales-house case).
model RateCardRequest {
  id              String    @id @default(cuid())
  recipientEmail  String
  recipientName   String?
  locale          String    // "no" | "sv" | "da" | "fi" | "de" | "en"
  token           String    @unique
  // Sequence state
  sentCount       Int       @default(0)   // 0 = not sent, 1 = initial sent, 2 = bump1 sent, 3 = bump2 sent
  lastStepAt      DateTime?
  nextStepAt      DateTime?
  sentAt          DateTime? // first send (kept for parity with PriceRequest)
  openedAt        DateTime?
  respondedAt     DateTime?
  cancelledAt     DateTime?
  expiresAt       DateTime
  // Response payload (set on submit)
  mediaKitUrl      String?
  mediaKitObjectKey String?      // R2 key when uploaded
  responseNote     String?
  formatsOffered   String[]      // ["native_article", "advertorial", "brand_stories", "video_native", "native_display"]
  contactName      String?       // recipient's corrected name
  contactEmail     String?       // recipient's corrected email
  contactRole      String?
  responseData     Json?          // [{titleId, price, currency, unit, skip}]
  responseSource   RateCardResponseSource?
  // Bookkeeping
  createdById      String
  createdBy        User      @relation(fields: [createdById], references: [id])
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  titles           RateCardRequestTitle[]
  @@index([recipientEmail])
  @@index([nextStepAt, respondedAt, cancelledAt])
  @@index([respondedAt])
}

enum RateCardResponseSource { FORM EMAIL }

model RateCardRequestTitle {
  rateCardRequestId String
  rateCardRequest   RateCardRequest @relation(fields: [rateCardRequestId], references: [id], onDelete: Cascade)
  titleId           String
  title             Title @relation(fields: [titleId], references: [id], onDelete: Cascade)
  @@id([rateCardRequestId, titleId])
  @@index([titleId])
}

// Sub-system B: suppression list (unsubscribe, bounce, complaint)
model OutreachSuppression {
  email     String   @id     // normalised
  reason    String           // "unsubscribe" | "bounce" | "complaint" | "manual"
  createdAt DateTime @default(now())
}
```

Add a `User.rateCardRequests` back-relation for completeness.

---

## Sub-system A: scraper + admin-review

### Scraper: `scripts/scrape-publisher-contacts.ts`

Manual batch (`pnpm scrape-contacts`). Idempotent — `@@unique([publisherId, email])` blocks duplicates on rerun. Skips publishers that already have an APPROVED candidate.

**Per-publisher algorithm:**

1. Pick representative URL: first `Title.websiteUrl WHERE url_status='VERIFIED'` for the publisher's titles. Log `no_url` and skip if none.
2. Probe locale-specific paths:
   - NO/SE/DK: `/annonsere`, `/annonsorer`, `/annonsering`, `/kontakt`, `/om-oss`
   - FI: `/mainosta`, `/yhteystiedot`
   - DE/AT/CH: `/werben`, `/kontakt`, `/impressum`
   - UK/IE: `/advertise`, `/advertising`, `/contact`, `/contact-us`
   - Always probe homepage; follow same-domain links whose text matches `/(annonse|werben|advert|sales|mainos)/i`
3. Fetch with 5s timeout, User-Agent identifying NativeSpin and linking back to a documentation page. Respect `robots.txt`.
4. Parse with `cheerio`:
   - `a[href^="mailto:"]` — strongest signal; capture address + sibling text for name
   - Plain-text email regex as fallback, but only within nodes whose surrounding text (200 chars) contains sales/annonse/werben/mainos vocabulary
   - Name inference: nearest `<h*>`, `<dt>/<dd>`, table-row siblings, schema.org Person blocks
5. Confidence scoring (0–100):
   - +50 mailto link (vs scraped text)
   - +30 found on annonse-specific path (not generic /kontakt)
   - +20 surrounding text matches sales vocabulary
   - +20 has an associated name
   - +10 email domain matches publisher domain
   - Clamp 0–100
6. `prisma.contactCandidate.upsert` per `(publisherId, email)`. Reviewed state is preserved across reruns.

**Throttling:**
- 1 request/sec per host (per `URL.hostname`)
- 10 concurrent across hosts
- Respect `robots.txt`

**Logging:**
- Per publisher: `[i/N] domain.no — 2 candidates (best confidence: 85, 40)`
- Summary at end: `scraped: 750, no_url: 48, errors: 12, candidates_inserted: 1140`

### Admin UI: `/desk/publisher-contacts`

Gated by `requireSuperadmin` (same as `sendPublisherInvite`).

**List view** — one row per publisher with at least one PENDING candidate:
- Columns: Publisher · Market · #titles · Top candidate (`name | role | email | confidence`) · Source link · Actions
- Filters: market, status (pending/approved/rejected), min-confidence
- Counts at top: `Pending: 612 · Approved: 134 · Rejected: 52 · No URL: 48`

**Per-row actions:**
- **Approve** — calls `createSalesContact` + `attachContactToTitle` for all publisher's titles (mark as primary), sets `ContactCandidate.status=APPROVED` + `salesContactId`. Audit `candidate.approve`.
- **Edit & Approve** — modal to correct name/role/email before creation.
- **Reject** — sets `status=REJECTED` with optional reason. Next scrape rerun will re-evaluate the publisher.
- **Show all candidates** — expand row when >1 email found.

**Top-level actions:**
- "Bulk-approve all with confidence ≥ 80" button (super-admin only).
- Re-scrape from UI is **not** in v1 — use `pnpm scrape-contacts`.

### GDPR

Publicly-listed B2B sales contacts; lawful basis is legitimate interest (Art. 6(1)(f)). `ContactCandidate.sourceUrl` documents the data origin per candidate. Suppression-list handles future opt-out (see sub-system B).

---

## Sub-system B: outreach campaign

Two-phase: `build` (group recipients) → `send` (throttled, sequenced).

### Build phase: `pnpm build-rate-card-campaign`

Idempotent. Steps:

1. Load every `SalesContact` (approval already happened in A).
2. Exclude any whose `normaliseEmail(email)` is in `OutreachSuppression`.
3. Group by `normaliseEmail(email)`. Per group:
   - Pick longest non-null `name` as `recipientName`
   - Collect all distinct `titleId`s via `SalesContactTitle` joins
   - Compute dominant locale: most common `Title.market.code` → `localeForMarketCode`
4. For each group: `prisma.rateCardRequest.upsert` on `recipientEmail` for active (non-cancelled, non-expired) requests. Insert `RateCardRequestTitle` rows for new titles.
5. Print summary: `requests_created, requests_skipped_existing, titles_covered`.

### Send phase

Two entry points wrapping the same `sendRateCardStep(requestId, stepKind)`:

- **CLI:** `pnpm send-rate-card-batch [--limit 20] [--min-confidence 70] [--dry-run]` — manual daily run.
- **UI:** "Send" / "Resend" buttons in the desk admin (extends the publisher-contacts page with a "Campaign" tab).

**Per-send logic:**

```ts
async function sendRateCardStep(requestId: string, actorId: string) {
  const req = await prisma.rateCardRequest.findUnique({ where: { id: requestId }, include: { titles: { include: { title: { include: { publisher: true, market: true } } } } }});
  if (!req) throw new Error("not_found");
  if (req.respondedAt) return { skipped: "responded" };
  if (req.cancelledAt) return { skipped: "cancelled" };
  if (req.expiresAt <= new Date()) return { skipped: "expired" };

  const suppressed = await prisma.outreachSuppression.findUnique({ where: { email: req.recipientEmail }});
  if (suppressed) { await recordAudit(actorId, "outreach.skipped_suppressed", `RateCardRequest:${req.id}`, { reason: suppressed.reason }); return { skipped: "suppressed" }; }

  const stepKind: SequenceStep = stepKindForCount(req.sentCount); // 0→"initial", 1→"bump1", 2→"bump2"
  const { subject, text, html } = buildOutreachEmail({ step: stepKind, locale: req.locale, recipientName: req.recipientName, titles: req.titles.map(t => t.title), token: req.token });

  await outreachLimiter.checkOrThrow(`outreach-send`); // process-wide

  await emailAdapter({
    to: req.recipientEmail,
    subject, text, html,
    replyTo: process.env.OUTREACH_REPLY_TO,
    headers: {
      "List-Unsubscribe": `<${siteOrigin()}/${req.locale}/rate-card/${req.token}/unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  await prisma.rateCardRequest.update({
    where: { id: req.id },
    data: {
      sentCount: req.sentCount + 1,
      lastStepAt: new Date(),
      nextStepAt: nextStepDate(stepKind), // null after step 2 (no more follow-up)
      sentAt: req.sentAt ?? new Date(),
    },
  });
  await recordAudit(actorId, `rate_card_request.send.${stepKind}`, `RateCardRequest:${req.id}`, { to: req.recipientEmail });
}
```

**Batch CLI:**
- Selects up to `--limit` requests where `(sentCount=0)` OR `(nextStepAt <= now AND respondedAt IS NULL AND cancelledAt IS NULL AND sentCount < 3)` ORDER BY `nextStepAt NULLS FIRST, createdAt`.
- Enforces hourly + daily caps from env.

### Sequence cadence

| Step | When | Template tone |
|------|------|---------------|
| `initial` | Day 0 | Buyer-pipeline hook + full title list |
| `bump1` | Day +5 (if not responded) | Short reminder, same link |
| `bump2` | Day +12 (if not responded) | Break-up — "if you're not the right person, point us to who is" |

Sequence stops immediately on: `respondedAt`, `cancelledAt`, or `OutreachSuppression`.

### Throttling / deliverability

- `OUTREACH_DAILY_CAP=20` (env-configurable; CLI enforces). Sustainable warm-up.
- `OUTREACH_HOURLY_CAP=8` — avoids spam-trap burst patterns.
- New `outreachLimiter = new RateLimiter(8, 8/3600)` in `lib/rate-limit.ts`.
- `OUTREACH_FROM` env (e.g., `"NativeSpin Partnerships <partnerships@nativespin.com>"`).
- `OUTREACH_REPLY_TO` env — a real desk inbox; replies handled manually by desk humans in v1.
- DKIM, SPF, DMARC verified on the sending domain in Resend before first batch.

### List-Unsubscribe (Gmail/Yahoo 2024 bulk-sender requirements)

Every outreach email gets these headers:
```
List-Unsubscribe: <https://nativespin.com/<locale>/rate-card/<token>/unsubscribe>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

The unsubscribe link is also clearly visible in the email footer.

### Email content — `lib/outreach/email.ts`

Mirrors `lib/pricing/email.ts` structure (one builder function per locale). Six locales: `en, no, sv, da, fi, de`.

**Step `initial` (Norwegian example):**

```
Subject: Native-rate cards for <salgshus/publisher> — buyer-pipeline i NativeSpin

Hei <navn || "Annonseteam">,

Vi har annonsører som leter etter native- og annonsørinnhold-inventar
på tvers av Norden, DACH og UK/IE, og <salgshus>'s titler er på listen.
For å være klar når en konkret henvendelse kommer, trenger vi
oppdaterte rate cards for følgende formater:

  • Native artikkel / annonsørinnhold
  • Sponset innhold
  • Brand stories
  • Video native
  • Andre formater dere tilbyr

Titler dette gjelder:
  • <Title 1>
  • <Title 2>
  • ...og <N> til — se full liste på lenken

<Send oss rate cards> (lenken er gyldig i 30 dager)

Hvis dette ikke er riktig kontakt, gjerne videresend internt — eller
gi oss beskjed via lenken.

— NativeSpin

<Avregistrer fra videre kommunikasjon>
```

**Step `bump1`:**
```
Subject: Re: Native-rate cards for <salgshus/publisher>

Hei <navn>,

Bare et kort kakk på døra i tilfelle den forrige e-posten ble begravet.
Vi venter fortsatt på rate cards for <N> titler — lenken er fortsatt aktiv:

<lenke>

— NativeSpin
```

**Step `bump2`:**
```
Subject: Riktig kontakt for rate cards hos <salgshus/publisher>?

Hei <navn>,

Vi har prøvd å nå rette kontakt for rate cards på <N> titler i NativeSpin-
katalogen. Hvis det ikke er deg, kan du peke oss til hvem som er?

<lenke for å oppdatere kontakt>

Hvis dere ikke er interessert i å være listet for native i NativeSpin,
gi gjerne beskjed her: <avregistrer-lenke> — så stopper vi videre kontakt.

— NativeSpin
```

Same structure in en/sv/da/fi/de. **Integrity note:** the "we have advertisers looking" framing must be true at the aggregate level (real buyer-pipeline activity exists at NativeSpin); it must not claim a specific buyer for a specific publisher. If this isn't true at the aggregate level, rewrite the hook before going live.

### Cancel / unsubscribe / suppression

- **Unsubscribe** (`GET /[locale]/rate-card/[token]/unsubscribe`, no auth):
  - Set `RateCardRequest.cancelledAt`
  - `OutreachSuppression.upsert(email, reason: "unsubscribe")` — this is what distinguishes an unsubscribe from a desk-side cancel; no separate `unsubscribedAt` field needed
  - Render per-locale confirmation
  - Audit `outreach.unsubscribe`
- **Manual cancel** (superadmin UI button): same effect minus the suppression entry; the recipient may still be contacted in future campaigns.
- **Bounce / complaint:** v1 manual — desk adds to suppression via UI when they see bounces in Resend dashboard. v2: Resend webhook auto-populates.

---

## Sub-system C: response page

### Page: `src/app/[locale]/rate-card/[token]/page.tsx`

Server component. Same pattern as `/[locale]/price-request/[token]`.

- Load `findRateCardRequestByToken(token)` with full title list (`titles[].title.publisher.market`).
- On first GET: `markRateCardRequestOpened(token)` (idempotent — sets `openedAt` only if null).
- Verdict via `checkRequest`:
  - `null` → 404-style "lenken er ugyldig"-page (per locale)
  - `expired` / `responded` / `cancelled` → status-specific page
  - `ok` → render the form

### Form

```
Hei!

Du har fått en rate-card-forespørsel for <N> titler:
  • Aftenposten (NO)
  • Bergens Tidende (NO)
  • ...

── Hvordan svare ──

[A] Last opp mediakit eller rate card-fil
    <file-picker: PDF/PPTX/PNG/JPG, max 25 MB>

[B] Lim inn lenke til ekstern rate card-side
    <text: URL>

[C] Priser per title (valgfritt)
    For hver title:
      • <Title>  <price> <currency> <unit: CPM/CPC/flat>  ☐ Skip
    
[D] Kort melding
    <textarea>

Native-formater dere tilbyr:
  ☐ Native artikkel / annonsørinnhold
  ☐ Sponset innhold
  ☐ Brand stories
  ☐ Video native
  ☐ Native display
  ☐ Annet

Kontakt for oppfølging:
  Navn   <prefilled from recipientName>
  E-post <prefilled from recipientEmail, editable>
  Rolle  <text>

<Send svar>      <Avregistrer fra videre kommunikasjon>
```

At least one of (file upload, URL, per-title prices with any price, response note) must be set to submit.

### Server action: `submitRateCardAction(formData)`

Mirrors `submitPriceRequestAction`:

```ts
- token = str(formData, "token")
- rfqLimiter.check(`rc-submit:${ip}:${token.slice(0,16)}`)
- req = findRateCardRequestByToken(token); if (!req) redirect
- verdict = checkRequest({ expiresAt, respondedAt, cancelledAt }); if (!verdict.ok) redirect
- Parse: mediaKitObjectKey (from R2 upload step), mediaKitUrl, responseData[], responseNote, formatsOffered[], contactName, contactEmail, contactRole
- Validate: at least one substantive field is set
- prisma.rateCardRequest.update({ data: { ...allFields, respondedAt: now, responseSource: "FORM" }})
- recordAudit("rate_card.submit", `RateCardRequest:${req.id}`, { source: "FORM", hasFile: !!objectKey, hasUrl: !!url, hasPrices: !!responseData?.length, hasNote: !!responseNote })
- redirect(/[locale]/rate-card/[token]/thanks)
```

### File upload via Cloudflare R2

**Generic helper at `lib/storage/r2.ts`:**

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
});

export async function presignUpload(args: { prefix: string; filename: string; contentType: string; maxBytes?: number; ttlSec?: number; }): Promise<{ url: string; key: string }> { ... }
export async function presignDownload(args: { key: string; ttlSec?: number; }): Promise<string> { ... }
```

The `prefix` parameter means this helper works for any future blob need (rate-card uploads use `rate-cards/<token>/<uuid>-<filename>`; future native-placement images can use `placements/...` without re-wiring R2).

**Upload flow:**

1. User picks file in the response form.
2. Client-side: POST to `submitRateCardUpload` server action → returns pre-signed PUT URL (TTL 5 min) + the resulting object key.
3. Browser PUTs the file directly to R2.
4. Form submit includes the `objectKey` in `formData`.
5. Server stores `mediaKitObjectKey` on `RateCardRequest`.

**Constraints:**
- Max 25 MB (enforced by pre-signed URL conditions)
- Allowed `Content-Type`: PDF, PPTX, PNG, JPG
- Bucket: private; desk views via pre-signed GET URLs (TTL 1 hour)

**Env vars:**
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET=nativespin-rate-cards` (or one bucket for everything: `nativespin-blob`)

### Thanks page

`src/app/[locale]/rate-card/[token]/thanks/page.tsx` — per-locale confirmation. Mirrors `/price-request/[token]/thanks`.

### Inbound email replies (fallback)

Some recipients will hit reply instead of clicking. Reply-To = `OUTREACH_REPLY_TO` env (a real desk inbox). Desk-humans read these manually. When they enter the data, the admin UI lets them mark a `RateCardRequest` as responded with `responseSource: "EMAIL"`.

No webhook in v1.

---

## Error handling

### A (scraper)
- Network errors: per-publisher try/catch, log, continue. Counted in summary.
- HTTP 4xx/5xx: log + skip. Idempotent rerun.
- `robots.txt` disallow: respect, log `skipped: robots`.
- Charset issues: use response `Content-Type`, fall back to utf-8.
- Captcha/Cloudflare block: log + skip. Manual review catches publishers with no candidates.
- JS-rendered SPA: out-of-scope for v1; results in `no_candidates`, handled manually.

### B (outreach)
- Resend send failure: catch, restore `sentCount` (decrement), audit `rate_card_request.send_failed`. Manual retry via UI.
- Suppression hit: skip without throw, audit `outreach.skipped_suppressed`.
- Rate-limit hit: abort batch, don't burn other slots.
- Locale template missing: fall back to English, audit `outreach.locale_fallback`.
- Concurrent build runs: same `recipientEmail` upsert is safe.

### C (response page)
- Expired / responded / cancelled / not-found: dedicated per-locale status pages.
- Form submit after expiry: server-side re-check via `checkRequest`, redirect to status page.
- Validation: at least one substantive field required.
- R2 upload failure: response action gracefully accepts other channels (URL / note) without the file.
- Rate-limit: existing `rfqLimiter` bucket per `(IP, token-prefix)`.

---

## Testing

### Unit (Vitest, pure TS)
- `lib/outreach/scoring.ts` — confidence function against inputs
- `lib/outreach/extract.ts` — HTML fixtures in `test-fixtures/scraper/*.html` → expected candidates (mailto, context-match, name inference)
- `lib/outreach/dedup.ts` — grouping SalesContacts by normalised email
- `lib/outreach/tokens.ts` — token shape, `checkRateCardRequest` for each verdict
- `lib/outreach/sequence.ts` — `stepKindForCount`, `nextStepDate` logic
- `lib/outreach/email.ts` — snapshot per locale for each sequence step

### Integration (Prisma + test DB)
- `approveCandidate` creates SalesContact and attaches all publisher's titles
- `buildRateCardCampaign` groups 5 SalesContacts sharing one email → 1 request with all titles
- `sendRateCardStep`: happy path sets `sentCount`+1 and `nextStepAt`; suppression-hit skips; cancelled throws; locale fallback works
- `submitRateCardAction`: persists `responseData` JSON, sets `respondedAt`, validates required-one-of
- Unsubscribe: sets `cancelledAt` + writes `OutreachSuppression`

### E2E (Playwright vs local app)
- Admin approves a candidate → `/desk/publisher-contacts` shows approved state + SalesContact row exists
- Visit `/no/rate-card/[token]` → form renders with correct title list + locale
- Upload PDF → R2 receives it, form submit links it
- Submit → thanks page, `respondedAt` set
- Re-visit same token → "already responded" page
- Click unsubscribe link → suppression row exists, request cancelled

### Manual smoke (post-deploy)
- DKIM/SPF/DMARC verified in Resend
- Send 5 test emails to internal addresses (one per locale) → verify rendering, unsubscribe header present
- One full end-to-end pass: scrape one publisher → approve → build → send to a real internal address → submit response with file → desk views the file via pre-signed URL

---

## Deploy checklist (post-implementation)

1. Migration: `pnpm prisma migrate deploy` for the new models + enums
2. Env vars on Railway:
   - `OUTREACH_DAILY_CAP=20`
   - `OUTREACH_HOURLY_CAP=8`
   - `OUTREACH_FROM="NativeSpin Partnerships <partnerships@nativespin.com>"`
   - `OUTREACH_REPLY_TO=partnerships@nativespin.com`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
3. Cloudflare: create R2 bucket, generate API token
4. Resend: verify DKIM/SPF/DMARC on `nativespin.com`, confirm send-from address is allowed
5. Run `pnpm scrape-contacts` once
6. Manually review the first 20 candidates as a sanity check
7. `pnpm build-rate-card-campaign --dry-run` to inspect groupings
8. Send 5 test emails to internal addresses; click through and submit one full response
9. First real batch: 20 high-confidence approved recipients

## Observability

- Audit events: `candidate.approve`, `candidate.reject`, `rate_card_request.create`, `rate_card_request.send.initial`, `rate_card_request.send.bump1`, `rate_card_request.send.bump2`, `rate_card_request.send_failed`, `rate_card.submit`, `outreach.unsubscribe`, `outreach.skipped_suppressed`, `outreach.locale_fallback`
- Resend dashboard: opens, bounces, complaints — checked daily for the first weeks
- CLI summaries on each `scrape-contacts` / `build-rate-card-campaign` / `send-rate-card-batch` run: `{processed, succeeded, skipped_<reason>, failed}`

---

## What this spec does NOT cover (deferred)

- **Sub-system D — pipeline-status-UI:** per-publisher operator view across the whole funnel. Design after we see real data shape from A+B+C.
- **Resend bounce webhook:** v1 manual; v2 auto-suppression on bounce/complaint.
- **JS-rendered scraping:** Playwright fallback for publishers with SPAs that hide contacts in client-rendered JS. Add only if scraping coverage proves insufficient.
- **A/B testing of subject lines / cadence:** add only when sample size and product-market fit justify it.
- **Auto-mapping of `responseData` → `PriceQuote` / `Title.publishedRatePrice`:** desk transcribes manually in v1; reasonable to automate once response patterns are understood.
- **Native-placement-illustration images** (separate feature): the generic `lib/storage/r2.ts` helper added in C is designed so this future use case needs no additional R2 configuration.
