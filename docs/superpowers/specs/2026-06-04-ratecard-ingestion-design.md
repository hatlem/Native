# Rate-card ingestion: PDF storage + OCR + structured capture — design spec

**Date:** 2026-06-04
**Status:** Approved by user, building
**Context:** Part of the Admirate price-gathering campaign ([[outreach_admirate_campaign]]). Publishers reply with prices — often as media-kit PDFs. We must store the PDFs (history), OCR them (incl. prices stored as images), capture all info as structured data, detect what's missing per publication, and follow up by email for gaps.

## Goals
1. **Store every received rate-card/media-kit PDF** durably with history (reuse R2 — `src/lib/storage/r2.ts`, S3 API, already used for media-kit uploads via `mediaKitObjectKey`).
2. **OCR fully**: extract digital text (`pdf-parse`) AND OCR image-embedded content (so prices stored as images aren't missed). Store extracted text only — do NOT store extracted images. Keep the original PDF.
3. **Capture ALL info as structured data**, extensible as new data patterns appear.
4. **Completeness check per publication** → if missing, send a targeted follow-up email.

## Data model

### New: `RateCardDocument` (raw storage + history)
```prisma
model RateCardDocument {
  id            String   @id @default(cuid())
  titleId       String?
  title         Title?   @relation(fields: [titleId], references: [id])
  publisherId   String?
  publisher     Publisher? @relation(fields: [publisherId], references: [id])
  contactLogId  String?
  contactLog    ContactLog? @relation(fields: [contactLogId], references: [id], onDelete: SetNull)
  fileName      String
  objectKey     String   // R2 key
  contentType   String   @default("application/pdf")
  sizeBytes     Int?
  ocrText       String?  // full extracted text (digital + image OCR)
  ocrStatus     String   @default("PENDING") // PENDING | DONE | FAILED
  source        String?  // e.g. "email:andreas@admirate.no"
  receivedAt    DateTime @default(now())
  createdById   String
  createdAt     DateTime @default(now())
  @@index([titleId]); @@index([publisherId]); @@index([contactLogId])
}
```

### Extend `PriceQuote` (per-offer pricing)
- Add `priceUnit` enum **`PriceUnit { FLAT CPC CPM }`** (default FLAT) — `price` holds the value, unit gives semantics (so CPC/CPM are captured). `includedText`/`excludedText` already exist.
- Add `rateCardDocumentId String?` (+ relation, onDelete SetNull) to link a quote to its source document.

### Per-publication commercial profile (extend `Title`)
- `reach` / `monthlyReach` / `digitalReach` already exist (readers/reach).
- Add `ownContentAllowed` enum **`OwnContent { YES NO WITH_APPROVAL UNKNOWN }`** (default UNKNOWN) — can we deliver our own articles.
- Add `contentPolicy String?` — their special content policy.
- Add `commercialExtra Json?` — any other info that has no structured field yet (nothing is lost).

### Extensibility principle
Raw OCR text is always retained on `RateCardDocument`; uncategorised info goes in `commercialExtra` (Json). Review incoming data periodically and **promote recurring `commercialExtra` keys to real columns** (e.g. click-through rate, lead time, format specs) as patterns emerge.

## Pipeline
1. **Ingest**: PDF (from email reply / forwarded to GetMailer `svar@getia.no` / manual upload) → store in R2 via `r2.ts` → create `RateCardDocument` (PENDING).
2. **OCR** (`src/lib/ratecard/ocr.ts`): `pdf-parse` for digital text; rasterise pages + `tesseract` OCR for image content; combine → `ocrText`, set `ocrStatus=DONE`. (Claude can also read PDFs directly via the Read tool for immediate manual processing.)
3. **Extract → structured**: parse `ocrText` → `PriceQuote` rows (price + `priceUnit` FLAT/CPC/CPM + included/excluded, linked to `rateCardDocumentId` + ContactLog); update Title commercial fields (reach, `ownContentAllowed`, `contentPolicy`, `commercialExtra`).
4. **Completeness check per publication**: COMPLETE = has annonsørinnhold price + what's included + own-article/approval known. Missing any → list the gap.
5. **Follow-up**: for publications with gaps → targeted email asking specifically for the missing piece (per [[outreach_admirate_campaign]] reply policy: reply only to get missing info / answer questions; advertiser tailored per publication; never commit budget).

## Desk UI
Add a "Rate cards / mediekit" panel on the title detail page (`desk/titles/[id]`) listing stored `RateCardDocument`s (filename, received date, source, link to R2 file, OCR-status) with the extracted quotes nested. Super-admin only.

## Build order (subagent-driven)
1. Schema + migration (RateCardDocument, PriceUnit, OwnContent enums, PriceQuote.priceUnit + rateCardDocumentId, Title.ownContentAllowed/contentPolicy/commercialExtra, back-relations).
2. Storage lib: `src/lib/ratecard/store.ts` (R2 put + create RateCardDocument) reusing `r2.ts`.
3. OCR lib: `src/lib/ratecard/ocr.ts` (pdf-parse + tesseract image OCR).
4. Extraction + completeness: `src/lib/ratecard/extract.ts` (+ gap helper) + extend quote logging with priceUnit/rateCardDocumentId.
5. Desk panel + mount.
6. Run on current replies (download PDFs, store, OCR, log, gap-check, follow-up).

## Notes
- Prod DB internal-only — run scripts via `railway run --service Postgres sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm tsx ...'`. Migrations hand-authored, idempotent. Tests: `tsx --test` (node:test); DB-touching tests `*.it.test.ts` gated by RUN_DB_IT.
- tesseract + PDF rasterisation are the heaviest deps — implement text-extraction first (covers most digital media kits), add image OCR; OCR runs as a background step, never blocking ingestion.
