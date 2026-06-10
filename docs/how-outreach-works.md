# How it works: collecting publications & sending outreach

End-to-end explanation of how NativeSpin builds its catalog of publications
and runs price-collection outreach to their ad-sales contacts. Two halves:

1. **Collecting publications** — sourcing titles, verifying they're real &
   current, finding confirmed ad-sales emails. (The catalog.)
2. **Sending mail** — asking those contacts for native/advertorial prices,
   logging every touch, and ingesting the replies as structured prices.

The guiding rule for both is in [`catalog-data-standard.md`](./catalog-data-standard.md):
**a wrong title or a guessed email is worse than a missing one** — it makes
the catalog lie and burns sender reputation. Default to *quarantine over
guess*, *uncertain over fake*, *deactivate over delete*.

---

## 1. The data model

The whole flow lives in a small set of Prisma models (`prisma/schema.prisma`):

```
Publisher ──< Title ──< Product (a sellable placement, e.g. NATIVE_ARTICLE)
   │            │
   │            ├──< SalesContactTitle >── SalesContact   (who to email)
   │            │
   │            ├──< ContactLog          (every outreach touch / reply)
   │            │        └──< PriceQuote (a price we captured)
   │            │
   │            ├──< PriceRequest        (a tokenised "please confirm prices" ask)
   │            │        └──< PriceQuote
   │            │
   │            └──< RateCardDocument    (a received media-kit PDF in R2 + OCR)
```

Key fields that drive outreach state, all on `Title`:

| Field | Meaning |
|---|---|
| `verificationStatus` | `UNVERIFIED` (default, untrusted) → `LIVE` / `DISCONTINUED` / `UNCERTAIN`. Confirmed-real gate. |
| `verificationSource` + `lastVerifiedAt` | The URL/reply backing the status, and when it was checked. Provenance is mandatory. |
| `discontinuedAt` / `discontinuedNote` | Set when a title is confirmed closed/merged/renamed. Drops it out of the catalog **and** the send list automatically. |
| `salesChannel` | `IN_HOUSE` / `DIRECT` / sales-house — drives who the email goes to. |
| `offersNativeContent` | `true` / `false` / `null` — the core dimension: does this title sell advertiser content at all. Set from replies. |
| `outstandingInfo[]` | Structured "what we still need" list (e.g. `["display CPM"]`) — drives gap follow-ups. |
| `aliases[]` | Alternative names, checked on import so we never re-create a duplicate. |

`SalesContact` is unique per `(publisherId, email)`; one contact can map to
many titles (a sales house sells for several publications), and one title can
have several contacts with one `isPrimary`.

---

## 2. Collecting publications

### 2.1 Where titles come from

Three ingestion paths, all upserting the same shape:

1. **CSV seed** (`prisma/data/medier_alle.csv`) — the original research
   catalog (~1,900 publishers / ~3,150 titles). **This is the untrusted
   source**: it was AI-compiled, its `URL_status=VERIFIED` flag was
   unreliable, it contained hallucinated titles, and it had **zero emails**.
   Everything downstream exists to make this trustworthy.
2. **Programmatic API** (`PUT /api/v1/publisher/products`, see
   [`publisher-ingestion.md`](./publisher-ingestion.md)) — a publisher pushes
   its own inventory with a per-publisher `catalog:write` API key. Upserts
   idempotently on `externalRef`. New titles land `active=false` (curation
   gate) until a super-admin approves them.
3. **Manual desk** — admin adds/edits a title in the desk UI.

### 2.2 The verification pipeline

A CSV row is **not** a publication until it's positively confirmed. The
pipeline (repeatable, re-runnable) turns raw rows into a sendable catalog:

**Step 1 — Deterministic harvester (cheap, no LLM).**
Fetch each contact's own domain, read **raw server-side HTML** (client tools
and `WebFetch` redact/mask emails), extract ad-sales addresses from
`annonsera`/`annons`/`kontakt`/`mediekit` pages, and classify each:
`VERIFIED` (exact address live on its own domain) / `CORRECTED` (a better ad
email found) / `REVIEW` / `UNCONFIRMED`. This cleared ~40% for free.

**Step 2 — Agent verification (the rest).**
One agent per publisher group (chunked to ≤10–12 titles each to avoid the
~450-concurrent throttle wall). Each agent web-checks every title and returns
a **sourced** verdict — `alive | dead | merged | renamed | uncertain` — and
extracts the ad email for anything the harvester couldn't confirm. Verdicts
are matched back **by title ID** (echoed by the agent), never by name, so a
rename can't cross-contaminate.

**Step 3 — Apply idempotently** (`scripts/apply-catalog-verification-db-*.ts`):
- `alive` → `verificationStatus=LIVE` + evidence URL + `lastVerifiedAt`.
- `dead`/`merged` → `discontinuedAt` + sourced `discontinuedNote`,
  `DISCONTINUED`; merged folds the old name into the survivor's `aliases`.
- `renamed` → rename in place, old name → `aliases`; folds into an existing
  survivor as a duplicate if the new name already exists in-market.
- `uncertain` → stays `UNCERTAIN` with the fresh note (excluded from outreach).
- **Guard:** never deactivate a title that has an `INBOUND` ContactLog — a
  real publisher reply outranks automated verification.

**Step 4 — Reconcile** into two lists: `*_verified.json` (sendable) and
`*_quarantine.json` (no confirmed address — never sent).

### 2.3 Emails are extracted, never guessed

Pattern-guessing is **banned**. `annonser@flamman.se` and
`bokaannads@ntmmedia.se` were both format-valid and both bounced; the correct
`annons@flamman.se` / `bokaannons@ntmmedia.se` were only found by reading the
site. If a domain is JS-rendered or unreachable and no address can be
confirmed → quarantine, don't send. Bounces and replies are ground truth: a
bounce is logged and the address fixed; a reply upgrades everything it touches
to `PUBLISHER_CONFIRMED`.

### 2.4 Data decays

Titles close, merge, and rebrand constantly. `lastVerifiedAt` is treated as
perishable — re-checked on a cadence, and **always re-verified immediately
before a send**. (The 2026-06-07 run re-checked all 1,290 remaining
unverified titles: 897 confirmed live, 114 deactivated, 64 renamed, 215 still
uncertain → zero unverified active titles remain.)

---

## 3. Sending mail

There are **two** mail paths. Know which is which.

### 3.1 The productized in-app path (`PriceRequest`)

Built into NativeSpin for self-serve use:

1. `createPriceRequest({ titleId, salesContactId })` mints a unique `token`
   and an `expiresAt` (default 30 days) — `src/lib/pricing/requests.ts`.
2. `sendPriceRequest()` builds a localised email
   (`src/lib/pricing/email.ts`, 6 languages keyed off market) containing a
   tokenised link `/{locale}/price-request/{token}` and a "just hit reply"
   fallback, then hands it to `emailAdapter` and stamps `sentAt`.
3. The contact either fills the tokenised form or replies; the response is
   recorded against the `PriceRequest` and attached as a `PriceQuote`.

> **Important:** `emailAdapter` defaults to a **console logger**
> (`src/lib/notify.ts`) — no Resend/Postmark provider is wired in prod. So
> this path is the *product surface*, not how the live campaign actually
> sends. That's path 3.2.

### 3.2 The live Admirate campaign (how mail actually goes out today)

For maximum reply rate, outreach is sent **personally**, not from an app:

- **Sender:** `andreas@admirate.no` via **Outlook web, manually driven in
  Chrome** (browser automation). Signature "Admirate (uten telefon)".
- **Cadence:** ~30/day (warm-up / anti-spam).
- **Recipients:** the deduped send list, `data/outreach/outreach_send_list.json` —
  `{ email, market, titles[] }`, **one row per address+market** (a sales
  house selling 8 titles = one email listing all 8). ~477 groups currently.
- **Template** (approved, `docs/admirate-priskampanje-oppsummering.md` §3):
  subject `Prisforespørsel på annonsørinnhold i {titler}`, body asks for
  native/advertorial rate cards, **titles inline not bulleted** (Outlook
  mangles dashes), **opening line varied** per recipient (anti-spam), **no
  signature in the body** (Outlook appends it), localised per market
  (NO→no, SE→sv, DK→da, FI→fi, DE/AT/CH→de, UK/IE→en).
- **Logging:** every send is recorded as a `ContactLog` with
  `direction=OUTBOUND`, `channel=EMAIL`, linked to the `SalesContact`, via
  the MCP tool `native_log_contact`. This is what makes the per-title
  contact history on the desk page truthful and prevents double-sends.

So the send list is the *queue*, Outlook is the *transport*, and `ContactLog`
is the *system of record*.

### 3.3 Pre-send checklist (enforced by the data standard)

A group is only cleared to send when **both**:
1. every title is real & current (`LIVE`, not discontinued/uncertain), and
2. the ad email is confirmed on the publisher's own domain.

Anything failing either test stays in `*_quarantine.json`.

---

## 4. Handling replies

Per reply (`docs/admirate-priskampanje-oppsummering.md` §H), worked in
Outlook then mirrored to prod via MCP:

1. Read the reply; download any media-kit / rate-card PDF.
2. Store the PDF in R2 + run **OCR** (`pdf-parse` for digital text +
   `tesseract.js` for image-only prices) → `RateCardDocument`
   (`src/lib/ratecard/`). Images themselves are never stored.
3. Log an **INBOUND** `ContactLog` (linked to the sales contact).
4. Record prices as `PriceQuote` rows — `native_log_quote` (against an
   existing `Product`) or `native_log_quote_draft` (for a new format with no
   product yet), each carrying `priceUnit` (FLAT/CPC/CPM) and, where
   relevant, the `rateCardDocumentId` and `contactLogId`.
5. Enrich the title: `offersNativeContent`, reach figures, `contentPolicy`,
   clear satisfied `outstandingInfo`, add `aliases`/`keywords`.
6. If the reply reveals a data error (closed/renamed/duplicate title), clean
   it immediately — deactivate/merge/rename — all reversible via `active`.

Quotes sit as **drafts** (`PriceQuote` with `appliedAt=null`); applying one
(`native_apply_quote`) writes the confirmed number to `Product.basePrice`.
Reply **only** to answer a question or request missing info (typically a
media kit) — never commit budget; the advertiser is kept at sector level
until a campaign is confirmed.

Inbound copies were meant to auto-forward to GetMailer (`svar@getia.no`) but
Admirate's M365 blocks external auto-forwarding (`550 5.7.520`), so replies
are read directly in Outlook until that's fixed in M365 admin.

---

## 5. The MCP control surface

Claude reads/writes the live prod data through the built-in MCP at
`https://nativespin.com/api/mcp` (header `X-API-Key`, scope `pricing:admin`;
mint with `pnpm issue-pricing-admin-key`). Tools (`src/lib/mcp/tools-*.ts`):

| Tool | Purpose |
|---|---|
| `native_list_titles_needing_price_check` | Find titles to chase. |
| `native_get_title` | Full title incl. products, contacts, recent quotes. |
| `native_create_sales_contact` / `native_attach_sales_contact` | Add/link who to email. |
| `native_create_price_request[_bulk]` | Mint price-request(s); `send=true` fires the in-app email. |
| `native_log_contact` | Record an OUTBOUND send or INBOUND reply. |
| `native_log_quote` / `native_log_quote_draft` | Capture a received price. |
| `native_apply_quote` | Promote a draft quote to `Product.basePrice`. |
| `native_list_contact_logs` / `native_list_open_price_requests` / `native_list_pending_quotes` | Read state. |

---

## 6. Current state (2026-06-07)

- Catalog: **2,524 LIVE / 418 DISCONTINUED / 215 UNCERTAIN** — zero
  unverified active titles.
- Send list: ~477 address-groups, all verified, ready to resume.
- Sent so far: 16 (NO), 45 OUTBOUND ContactLogs; first reply wave (7) processed.
- Next: resume the ~30/day sends (rest of NO, then SE/DK/FI/DE/AT/CH/UK/IE),
  process new replies, find addresses for the ~1,300 contactless publishers.

## 7. Key files

- Send list: `data/outreach/outreach_send_list.json` (+ `_verified` / `_quarantine`).
- Verification: `scripts/wf-verify-catalog-*.mjs`,
  `scripts/apply-catalog-verification-db-*.ts`, `catalog_verification_*.json`.
- Email build: `src/lib/pricing/email.ts`, `requests.ts`, `tokens.ts`.
- Contact log: `src/lib/pricing/contact-log.ts`.
- Rate cards/OCR: `src/lib/ratecard/{store,ocr,extract}.ts`.
- MCP: `src/lib/mcp/tools-{read,mutate}.ts`.
- Standards & history: `docs/catalog-data-standard.md`,
  `docs/admirate-priskampanje-oppsummering.md`, `docs/publisher-ingestion.md`.
