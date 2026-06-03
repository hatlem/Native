# Per-title contact log (kontakthistorikk) — design spec

**Date:** 2026-06-03
**Status:** Draft, pending user review
**Scope:** A per-title history of how we contacted each medium to gather prices — channel, direction, date, who, free-text note — with received offers (prices per product + what's included/excluded) attributed to the specific contact event.

## Problem

We are starting a campaign to contact every medium (publisher sales contact) to gather advertising prices for their titles. Outreach happens manually (email via Outlook/Chrome, phone, web forms), outside the platform's existing magic-link `PriceRequest` flow.

Today the platform can:
- Record *how a response came back* (`PriceRequest.responseSource` = `LINK_FORM` / `MANUAL_EMAIL` / `MANUAL_PHONE` / `MANUAL_OTHER`) — but only inside the formal link-request lifecycle.
- Record *received prices per product* with what's included/excluded (`PriceQuote.includedText` / `excludedText`; `priceRequestId` is nullable, so quotes can already be free-standing).

What is missing:
1. **No record of the outgoing contact event itself** — "we emailed this medium on 2 June via Outlook asking for prices" — when it happens outside the link flow.
2. **No conversation history per title** — what was said before, across multiple touches (different offers can include different things).
3. **No attribution from a received offer back to the contact event that produced it** — so we can't see "in this reply, they offered product X at price Y including Z."

This matters specifically because different offers can include different things; we need to find, per medium, what was said previously and which prices we got for which products.

## Goals

- A `ContactLog` timeline per `Title`: channel, direction (we asked / they answered), date, who on our side, free-text note.
- Optional link to the `SalesContact` we spoke with.
- Received offers attributed to a contact entry, reusing the existing `PriceQuote` model (prices per product, `includedText`/`excludedText`, `validUntil`, apply-to-catalog) — **no parallel price store**.
- A desk UI panel on the title detail page showing the timeline with offers nested under each entry.
- Auto-population hook: when an outreach email is sent via Chrome, an `OUTBOUND` `ContactLog` entry can be created for the affected title(s).

## Non-goals (v1)

- A cross-title "last contacted" column / freshness filter on `/desk/titles` (valuable for the campaign view — deferred to a small follow-up).
- Threading/replies UI beyond a flat, date-ordered list.
- Email/IMAP ingestion to auto-create `INBOUND` entries.
- Editing or re-applying already-applied `PriceQuote`s (history stays immutable — unchanged from existing behavior).
- Per-publisher (vs per-title) logging — decided per-title in brainstorm. One email covering several titles yields one entry per title.

## Decisions taken during brainstorm

- **Granularity:** per `Title` (matches "we want to know it on each medium"; one email → one entry per title).
- **Two layers:** `ContactLog` = the contact/conversation event ("what was said"); `PriceQuote` (existing) = the prices/offer contents. Linked by a new nullable FK.
- **Direction kept:** `direction` (`OUTBOUND` default / `INBOUND`) turns a contact log into a readable conversation thread and captures non-price replies ("we don't do native", "valid Q3 only") that a price-only log would lose.
- **Reuse, don't duplicate:** received prices are `PriceQuote` rows (the catalog's source of truth), recorded via the existing `logQuoteManually` path, with a new `contactLogId` link. Apply-to-catalog flow unchanged.
- **Naming:** model `ContactLog` (not `OutreachLog`) to avoid collision with the existing rate-card "outreach" campaign subsystem (`src/lib/outreach/`, `desk/publisher-contacts` "Campaign"). Same concept we discussed as the kontakthistorikk.

---

## 1. Data model

### New entities

```prisma
enum ContactChannel {
  EMAIL
  PHONE
  WEB_FORM
  LINKEDIN
  OTHER
}

enum ContactDirection {
  OUTBOUND   // we contacted them
  INBOUND    // they replied
}

model ContactLog {
  id             String   @id @default(cuid())
  titleId        String
  title          Title    @relation(fields: [titleId], references: [id])
  salesContactId String?
  salesContact   SalesContact? @relation(fields: [salesContactId], references: [id])
  channel        ContactChannel
  direction      ContactDirection @default(OUTBOUND)
  contactedAt    DateTime @default(now())   // editable; the day contact happened
  contactedById  String
  contactedBy    User     @relation("ContactLogAuthor", fields: [contactedById], references: [id])
  note           String?                    // free text — what was said
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  quotes PriceQuote[]                       // offers attributed to this contact

  @@index([titleId])
  @@index([contactedAt])
  @@index([salesContactId])
}
```

### Changes to existing models

```prisma
model PriceQuote {
  // ...existing fields unchanged...
  contactLogId String?
  contactLog   ContactLog? @relation(fields: [contactLogId], references: [id], onDelete: SetNull)

  @@index([contactLogId])
}

model Title {
  // ...existing...
  contactLogs ContactLog[]
}

model SalesContact {
  // ...existing...
  contactLogs ContactLog[]
}

model User {
  // ...existing...
  contactLogs ContactLog[] @relation("ContactLogAuthor")
}
```

### Migration

- `CREATE TYPE "ContactChannel"`, `CREATE TYPE "ContactDirection"`.
- Create `ContactLog` table + indexes.
- `ALTER TABLE "PriceQuote" ADD COLUMN "contactLogId" TEXT` + FK with `ON DELETE SET NULL` + index.
- No backfill: existing `PriceQuote`s simply have `contactLogId = NULL` (they came through `PriceRequest` or manual logging).
- Deleting a `ContactLog` nulls the link on any attributed `PriceQuote`s but never deletes them — applied prices must survive.

---

## 2. Library layer (`src/lib/pricing/contact-log.ts`)

New file, alongside existing `src/lib/pricing/*`. All logic here; actions are thin wrappers. Keep under ~200 lines.

- `createContactLog({ titleId, salesContactId?, channel, direction, contactedAt?, note?, actorUserId })` — creates the row, `recordAudit(actorUserId, "contact_log.create", "ContactLog:<id>", {...})`.
- `listForTitle(titleId)` — entries newest-first (`contactedAt desc`), `include` `salesContact` and `quotes` (with `product` for display).
- `editContactLog({ id, channel?, direction?, contactedAt?, note?, salesContactId?, actorUserId })` — correct mistakes; audit `contact_log.update`.
- `deleteContactLog({ id, actorUserId })` — audit `contact_log.delete`; relies on `ON DELETE SET NULL` so attributed quotes survive.

Extend `src/lib/pricing/quotes.ts`:
- `logQuoteManually(...)` gains an optional `contactLogId` parameter, set on the created `PriceQuote`. No other behavior change; `applyQuote` / `rejectQuote` untouched.

---

## 3. Server actions (`src/app/price-actions.ts`)

Add to the existing file (same `requireSuperadmin` gate, `revalidatePath(\`/${locale}/desk/titles/${titleId}\`)`):

- `addContactLogAction(formData)` — channel, direction, contactedAt, salesContactId?, note → `createContactLog`.
- `editContactLogAction(formData)` → `editContactLog`.
- `deleteContactLogAction(formData)` → `deleteContactLog`.
- `recordOfferFromContactAction(formData)` — wraps `logQuoteManually` with `contactLogId` (productId or draft product, price, currency, includedText?, excludedText?, validUntil?). Reuses existing quote validation.

Existing `applyQuoteAction` / `rejectQuoteAction` are reused as-is for offers recorded here.

---

## 4. Desk UI

### `/[locale]/desk/titles/[id]` — new `ContactHistoryPanel`

New server component `src/app/[locale]/desk/titles/[id]/_components/ContactHistoryPanel.tsx`, mounted on the title detail page next to `SalesContactsPanel` / `PriceRequestsPanel` / `PendingQuotesPanel`. Super-admin only (page already gated).

- **Add-entry form:** channel select, direction toggle (default Outbound), date (default today), optional sales-contact dropdown (this title's / publisher's contacts), note textarea.
- **Timeline:** entries newest-first. Each row: direction arrow + channel badge, `contactedAt`, author, note. Inline `Edit` / `Delete`.
- **Offers nested under an entry:** any attributed `PriceQuote`s shown as product/draft name · price + currency · included / excluded · `validUntil`, plus applied/pending state. A `Record offer` control on the entry opens the quote form (`recordOfferFromContactAction`); pending offers expose the existing `Apply` / `Reject` affordances.

Renders the timeline the user described:
```
02.06  → OUTBOUND  EMAIL   "Ba om priser på native + innstikk"
05.06  ← INBOUND   EMAIL   "Tilbud mottatt"
                           └─ Native      15 000 NOK · inkl. produksjon
                           └─ Innstikk     8 000 NOK
09.06  ← INBOUND   PHONE   "Native-prisen gjelder kun ut året"   (ingen offer)
```

### i18n

Admin strings added to `src/messages/{en,no,sv,da,de,fi}.json` (+ landing equivalents if desk strings live there), following existing desk conventions. Source English first, then translate (per project convention).

---

## 5. Chrome-outreach integration

When outreach email is sent via the browser flow, create an `OUTBOUND` `ContactLog` (`channel = EMAIL`) for each affected title via `createContactLog` (or `addContactLogAction`). This is the operational hook that keeps the log populated during the campaign; it reuses the same lib function, no special path.

---

## 6. Testing

Mirror existing Vitest patterns.

- `src/lib/pricing/contact-log.test.ts` — create/list/edit/delete; newest-first ordering; audit rows written; delete nulls `PriceQuote.contactLogId` but preserves the quote.
- Extend `src/lib/pricing/quotes.test.ts` — `logQuoteManually` with `contactLogId` links the quote to the entry; `applyQuote` on a contact-attributed quote still commits to `Product.basePrice` + `confirmedAt`.
- Optional one E2E addition (Playwright): add a contact entry on a title, record an offer under it, apply it, verify price on catalog. Proportionate — can fold into existing pricing E2E.

---

## 7. File-level summary

### New files
- `prisma/migrations/<date>_contact_log/migration.sql`
- `src/lib/pricing/contact-log.ts`
- `src/lib/pricing/contact-log.test.ts`
- `src/app/[locale]/desk/titles/[id]/_components/ContactHistoryPanel.tsx`

### Modified files
- `prisma/schema.prisma` (ContactLog model, ContactChannel/ContactDirection enums, PriceQuote.contactLogId, back-relations on Title/SalesContact/User)
- `src/lib/pricing/quotes.ts` (`logQuoteManually` accepts `contactLogId`)
- `src/app/price-actions.ts` (4 new actions)
- `src/app/[locale]/desk/titles/[id]/page.tsx` (mount ContactHistoryPanel)
- `src/messages/{en,no,sv,da,de,fi}.json` (admin strings)

---

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| One email covers many titles → many duplicate entries | Accepted (per-title decision). Chrome integration creates them automatically, so no manual duplication. Per-publisher rollup deferred. |
| Deleting a contact entry orphans applied prices | `ON DELETE SET NULL` — `PriceQuote`s survive with `contactLogId = NULL`; applied catalog prices untouched. |
| Confusion with existing rate-card "outreach" campaign | Named `ContactLog`, lives in `src/lib/pricing/`, scoped to per-title manual contact — distinct from `src/lib/outreach/` (RateCardRequest campaign). |
| Two price-capture paths (PriceRequest link vs ContactLog) drift | Both create `PriceQuote` via `src/lib/pricing/quotes.ts`; apply flow is shared. No parallel store. |

## 9. Open questions deferred to implementation

- Exact admin string wording per locale (reviewed during implementation).
- Whether to surface a "last contacted" column on `/desk/titles` (follow-up, not v1).
