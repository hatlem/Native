# Per-title contact log (kontakthistorikk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-`Title` contact history (channel, direction, date, who, note) with received offers (prices per product + included/excluded) attributed to each contact event, reusing the existing `PriceQuote` model.

**Architecture:** New `ContactLog` model + `ContactChannel`/`ContactDirection` enums. `PriceQuote` gains a nullable `contactLogId` (ON DELETE SET NULL) so offers recorded via the existing `logQuote` path attribute back to a contact entry. A new desk server-component panel (`ContactHistoryPanel`) renders the timeline with offers nested under each entry; mutations go through thin server actions in the existing `price-actions.ts`, which call a new `src/lib/pricing/contact-log.ts` lib (all logic, audited).

**Tech Stack:** Next.js App Router (server components + server actions), Prisma/PostgreSQL, next-intl, node:test via `tsx --test`. Spec: `docs/superpowers/specs/2026-06-03-contact-log-design.md`.

**Conventions confirmed in this repo:**
- Tests run with `pnpm test` (`tsx --test "src/**/*.test.ts"`). Pure tests: `*.test.ts`. DB-mutating integration tests: `*.it.test.ts`, gated by `RUN_DB_IT=1` against a disposable DB (see `src/lib/content-fee.it.test.ts`).
- `pnpm prisma migrate dev` is **blocked** here. Migrations are **hand-authored** idempotent SQL under `prisma/migrations/<timestamp>_<name>/migration.sql` and applied on deploy via `prisma migrate deploy`. After editing `schema.prisma`, run `pnpm prisma generate` to refresh client types locally.
- Type safety gate: `pnpm typecheck` (`tsc --noEmit`).
- Source English first, then translate to no/sv/da/de/fi.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` (modify) | `ContactLog` model, `ContactChannel`/`ContactDirection` enums, `PriceQuote.contactLogId`, back-relations on `Title`/`SalesContact`/`User` |
| `prisma/migrations/20260603120000_contact_log/migration.sql` (create) | Hand-authored DDL for the above |
| `src/lib/pricing/contact-log.ts` (create) | `createContactLog`, `listForTitle`, `editContactLog`, `deleteContactLog` — all audited |
| `src/lib/pricing/quotes.ts` (modify) | `logQuote` accepts optional `contactLogId` |
| `src/lib/pricing/contact-log.it.test.ts` (create) | Integration test for the lib (RUN_DB_IT gated) |
| `src/app/price-actions.ts` (modify) | `addContactLogAction`, `editContactLogAction`, `deleteContactLogAction`, `recordOfferFromContactAction` |
| `src/app/[locale]/desk/titles/[id]/_components/ContactHistoryPanel.tsx` (create) | Timeline UI + add/edit/delete/record-offer forms |
| `src/app/[locale]/desk/titles/[id]/page.tsx` (modify) | Mount the panel |
| `src/messages/{en,no,sv,da,de,fi}.json` (modify) | `contactLog` namespace strings |

---

## Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260603120000_contact_log/migration.sql`

- [ ] **Step 1: Add enums + model to `prisma/schema.prisma`**

Add near the other pricing models (after the `PriceQuote` model, around line 1134):

```prisma
enum ContactChannel {
  EMAIL
  PHONE
  WEB_FORM
  LINKEDIN
  OTHER
}

enum ContactDirection {
  OUTBOUND
  INBOUND
}

model ContactLog {
  id             String           @id @default(cuid())
  titleId        String
  title          Title            @relation(fields: [titleId], references: [id])
  salesContactId String?
  salesContact   SalesContact?    @relation(fields: [salesContactId], references: [id], onDelete: SetNull)
  channel        ContactChannel
  direction      ContactDirection @default(OUTBOUND)
  contactedAt    DateTime         @default(now())
  contactedById  String
  contactedBy    User             @relation("ContactLogAuthor", fields: [contactedById], references: [id])
  note           String?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  quotes PriceQuote[]

  @@index([titleId])
  @@index([contactedAt])
  @@index([salesContactId])
}
```

- [ ] **Step 2: Add the attribution field to `PriceQuote`**

In `model PriceQuote` (line ~1104), add these lines before the closing `}` (alongside the existing `@@index` lines):

```prisma
  contactLogId     String?
  contactLog       ContactLog? @relation(fields: [contactLogId], references: [id], onDelete: SetNull)

  @@index([contactLogId])
```

- [ ] **Step 3: Add back-relations to existing models**

In `model Title` (line ~249), add to the relations block:
```prisma
  contactLogs ContactLog[]
```
In `model SalesContact` (line ~1046), add:
```prisma
  contactLogs ContactLog[]
```
In `model User`, add (find the User model; it already has named relations like `PriceRequestRequester`):
```prisma
  contactLogs ContactLog[] @relation("ContactLogAuthor")
```

- [ ] **Step 4: Write the migration SQL**

Create `prisma/migrations/20260603120000_contact_log/migration.sql`:

```sql
-- Per-title contact log (kontakthistorikk) + attribution from received
-- offers (PriceQuote) back to the contact event. Additive. The PriceQuote
-- link is nullable with ON DELETE SET NULL so applied prices survive a
-- contact-log deletion.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ContactChannel" AS ENUM ('EMAIL', 'PHONE', 'WEB_FORM', 'LINKEDIN', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ContactDirection" AS ENUM ('OUTBOUND', 'INBOUND');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ContactLog" (
  "id" TEXT NOT NULL,
  "titleId" TEXT NOT NULL,
  "salesContactId" TEXT,
  "channel" "ContactChannel" NOT NULL,
  "direction" "ContactDirection" NOT NULL DEFAULT 'OUTBOUND',
  "contactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contactedById" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ContactLog_titleId_idx" ON "ContactLog"("titleId");
CREATE INDEX IF NOT EXISTS "ContactLog_contactedAt_idx" ON "ContactLog"("contactedAt");
CREATE INDEX IF NOT EXISTS "ContactLog_salesContactId_idx" ON "ContactLog"("salesContactId");

-- AlterTable: PriceQuote attribution link
ALTER TABLE "PriceQuote" ADD COLUMN IF NOT EXISTS "contactLogId" TEXT;
CREATE INDEX IF NOT EXISTS "PriceQuote_contactLogId_idx" ON "PriceQuote"("contactLogId");

-- Foreign keys
ALTER TABLE "ContactLog"
  ADD CONSTRAINT "ContactLog_titleId_fkey" FOREIGN KEY ("titleId")
  REFERENCES "Title"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContactLog"
  ADD CONSTRAINT "ContactLog_salesContactId_fkey" FOREIGN KEY ("salesContactId")
  REFERENCES "SalesContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContactLog"
  ADD CONSTRAINT "ContactLog_contactedById_fkey" FOREIGN KEY ("contactedById")
  REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_contactLogId_fkey" FOREIGN KEY ("contactLogId")
  REFERENCES "ContactLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 5: Regenerate the Prisma client**

Run: `pnpm prisma generate`
Expected: "Generated Prisma Client" with no schema validation errors. (If it reports a missing opposite relation, re-check Step 3 — every relation needs both sides.)

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (the new `prisma.contactLog` / `ContactChannel` / `ContactDirection` symbols now exist).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260603120000_contact_log/
git commit -m "feat(pricing): contact log schema + migration"
```

---

## Task 2: Write the failing integration test

**Files:**
- Create: `src/lib/pricing/contact-log.it.test.ts`

- [ ] **Step 1: Write the test**

Create `src/lib/pricing/contact-log.it.test.ts` (mirrors the gating pattern in `src/lib/content-fee.it.test.ts`):

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { logQuote } from "@/lib/pricing/quotes";
import {
  createContactLog,
  listForTitle,
  deleteContactLog,
} from "@/lib/pricing/contact-log";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("contact-log integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  let userId: string;
  let publisherId: string;
  let titleId: string;

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const user = await prisma.user.create({
      data: { email: `cl-it-${Date.now()}@example.com`, role: "SUPERADMIN" },
    });
    userId = user.id;
    const pub = await prisma.publisher.create({
      data: {
        name: `CL-IT publisher ${Date.now()}`,
        countryCode: market.code,
        marketId: market.id,
      },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: "CL-IT Title",
        slug: `cl-it-${Date.now()}`,
        publisherId: pub.id,
        countryCode: market.code,
        marketId: market.id,
      },
    });
    titleId = title.id;
  });

  after(async () => {
    await prisma.priceQuote.deleteMany({ where: { contactLog: { titleId } } });
    await prisma.contactLog.deleteMany({ where: { titleId } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  test("create + list returns newest first with attributed offers", async () => {
    const first = await createContactLog({
      titleId,
      channel: "EMAIL",
      direction: "OUTBOUND",
      note: "Ba om priser",
      actorId: userId,
    });
    const second = await createContactLog({
      titleId,
      channel: "EMAIL",
      direction: "INBOUND",
      note: "Tilbud mottatt",
      actorId: userId,
    });

    await logQuote({
      contactLogId: second.id,
      draftProductType: "NATIVE_ARTICLE",
      draftProductName: "Native",
      price: 15000,
      currency: "NOK",
      includedText: "inkl. produksjon",
      recordedById: userId,
    });

    const list = await listForTitle(titleId);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, second.id, "newest (INBOUND) first");
    assert.equal(list[1].id, first.id);
    assert.equal(list[0].quotes.length, 1);
    assert.equal(list[0].quotes[0].includedText, "inkl. produksjon");
  });

  test("delete nulls the quote link but keeps the quote", async () => {
    const entry = await createContactLog({
      titleId,
      channel: "PHONE",
      direction: "INBOUND",
      actorId: userId,
    });
    const quote = await logQuote({
      contactLogId: entry.id,
      draftProductType: "NATIVE_ARTICLE",
      draftProductName: "Innstikk",
      price: 8000,
      currency: "NOK",
      recordedById: userId,
    });

    await deleteContactLog({ id: entry.id, actorId: userId });

    const stillThere = await prisma.priceQuote.findUnique({ where: { id: quote.id } });
    assert.ok(stillThere, "quote survives contact-log deletion");
    assert.equal(stillThere!.contactLogId, null, "link is nulled");
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `RUN_DB_IT=1 pnpm test -- src/lib/pricing/contact-log.it.test.ts`
Expected: FAIL — `Cannot find module '@/lib/pricing/contact-log'` (the lib does not exist yet) or a typecheck/import error. (If no disposable DB is available, run `pnpm typecheck` instead and expect the missing-module error — that is the failing signal.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/pricing/contact-log.it.test.ts
git commit -m "test(pricing): failing contact-log integration test"
```

---

## Task 3: Implement the contact-log lib + extend logQuote

**Files:**
- Create: `src/lib/pricing/contact-log.ts`
- Modify: `src/lib/pricing/quotes.ts:43-72` (`logQuote`)

- [ ] **Step 1: Extend `logQuote` to accept `contactLogId`**

In `src/lib/pricing/quotes.ts`, change the `logQuote` signature and the `prisma.priceQuote.create` data. Replace the args type line:

```ts
export async function logQuote(args: QuoteInput & {
  priceRequestId?: string;
  contactLogId?: string;
  recordedById: string;
}) {
```

And inside the `data: { ... }` object, add this line (next to `priceRequestId`):

```ts
      contactLogId: args.contactLogId ?? null,
```

- [ ] **Step 2: Create the lib**

Create `src/lib/pricing/contact-log.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import type { ContactChannel, ContactDirection } from "@prisma/client";

export type CreateContactLogArgs = {
  titleId: string;
  salesContactId?: string;
  channel: ContactChannel;
  direction?: ContactDirection;
  contactedAt?: Date;
  note?: string;
  actorId: string;
};

export async function createContactLog(args: CreateContactLogArgs) {
  const entry = await prisma.contactLog.create({
    data: {
      titleId: args.titleId,
      salesContactId: args.salesContactId ?? null,
      channel: args.channel,
      direction: args.direction ?? "OUTBOUND",
      contactedAt: args.contactedAt ?? new Date(),
      note: args.note ?? null,
      contactedById: args.actorId,
    },
  });
  await recordAudit(args.actorId, "contact_log.create", `ContactLog:${entry.id}`, {
    titleId: args.titleId,
    channel: args.channel,
    direction: entry.direction,
  });
  return entry;
}

export function listForTitle(titleId: string) {
  return prisma.contactLog.findMany({
    where: { titleId },
    orderBy: { contactedAt: "desc" },
    include: {
      salesContact: true,
      quotes: {
        include: { product: true },
        orderBy: { recordedAt: "desc" },
      },
    },
  });
}

export type EditContactLogArgs = {
  id: string;
  channel?: ContactChannel;
  direction?: ContactDirection;
  contactedAt?: Date;
  note?: string | null;
  salesContactId?: string | null;
  actorId: string;
};

export async function editContactLog(args: EditContactLogArgs) {
  const entry = await prisma.contactLog.update({
    where: { id: args.id },
    data: {
      channel: args.channel,
      direction: args.direction,
      contactedAt: args.contactedAt,
      note: args.note,
      salesContactId: args.salesContactId,
    },
  });
  await recordAudit(args.actorId, "contact_log.update", `ContactLog:${entry.id}`, {
    channel: args.channel,
    direction: args.direction,
  });
  return entry;
}

export async function deleteContactLog(args: { id: string; actorId: string }) {
  await prisma.contactLog.delete({ where: { id: args.id } });
  await recordAudit(args.actorId, "contact_log.delete", `ContactLog:${args.id}`, {});
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `RUN_DB_IT=1 pnpm test -- src/lib/pricing/contact-log.it.test.ts`
Expected: PASS (2 tests). If no disposable DB is available locally, run `pnpm typecheck` and expect PASS, and flag in the task review that the DB assertions were not executed.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/contact-log.ts src/lib/pricing/quotes.ts
git commit -m "feat(pricing): contact-log lib + logQuote attribution"
```

---

## Task 4: Server actions

**Files:**
- Modify: `src/app/price-actions.ts`

- [ ] **Step 1: Add imports**

At the top of `src/app/price-actions.ts`, add to the existing import block from `@/lib/pricing/quotes` the `logQuote` (already imported), and add a new import group:

```ts
import {
  createContactLog,
  editContactLog,
  deleteContactLog,
} from "@/lib/pricing/contact-log";
import type { ContactChannel, ContactDirection } from "@prisma/client";
```

- [ ] **Step 2: Add the four actions**

Append to `src/app/price-actions.ts`:

```ts
// ---- Contact log (kontakthistorikk) ----

export async function addContactLogAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  const dateStr = optionalField(formData, "contactedAt");
  await createContactLog({
    titleId,
    salesContactId: optionalField(formData, "salesContactId"),
    channel: field(formData, "channel") as ContactChannel,
    direction: (optionalField(formData, "direction") as ContactDirection) ?? "OUTBOUND",
    contactedAt: dateStr ? new Date(dateStr) : undefined,
    note: optionalField(formData, "note"),
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

export async function editContactLogAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  const dateStr = optionalField(formData, "contactedAt");
  await editContactLog({
    id: field(formData, "id"),
    channel: field(formData, "channel") as ContactChannel,
    direction: field(formData, "direction") as ContactDirection,
    contactedAt: dateStr ? new Date(dateStr) : undefined,
    note: optionalField(formData, "note") ?? null,
    salesContactId: optionalField(formData, "salesContactId") ?? null,
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

export async function deleteContactLogAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  await deleteContactLog({ id: field(formData, "id"), actorId: userId });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

export async function recordOfferFromContactAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  const validUntilStr = optionalField(formData, "validUntil");
  await logQuote({
    contactLogId: field(formData, "contactLogId"),
    productId: optionalField(formData, "productId"),
    price: Number(field(formData, "price")),
    currency: field(formData, "currency"),
    includedText: optionalField(formData, "includedText"),
    excludedText: optionalField(formData, "excludedText"),
    validUntil: validUntilStr ? new Date(validUntilStr) : undefined,
    recordedById: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/price-actions.ts
git commit -m "feat(pricing): contact-log server actions"
```

---

## Task 5: Panel UI + mount + English strings

**Files:**
- Create: `src/app/[locale]/desk/titles/[id]/_components/ContactHistoryPanel.tsx`
- Modify: `src/app/[locale]/desk/titles/[id]/page.tsx`
- Modify: `src/messages/en.json`

- [ ] **Step 1: Add the `contactLog` namespace to `src/messages/en.json`**

Add this object at the top level of `src/messages/en.json` (sibling of the existing `salesContacts` namespace):

```json
"contactLog": {
  "title": "Contact history",
  "empty": "No contact logged yet.",
  "addNew": "Log a contact",
  "channel": "Channel",
  "direction": "Direction",
  "outbound": "We contacted them",
  "inbound": "They replied",
  "date": "Date",
  "contact": "Sales contact (optional)",
  "noContact": "— none —",
  "note": "Note",
  "save": "Save",
  "saving": "Saving…",
  "delete": "Delete",
  "deleting": "Deleting…",
  "recordOffer": "Record offer",
  "product": "Product (optional)",
  "draftHint": "Leave product empty to record a free-text offer.",
  "price": "Price",
  "currency": "Currency",
  "included": "What's included",
  "excluded": "What's not included",
  "validUntil": "Valid until",
  "applied": "Applied to catalog",
  "pending": "Pending",
  "channelEMAIL": "Email",
  "channelPHONE": "Phone",
  "channelWEB_FORM": "Web form",
  "channelLINKEDIN": "LinkedIn",
  "channelOTHER": "Other"
}
```

- [ ] **Step 2: Create the panel**

Create `src/app/[locale]/desk/titles/[id]/_components/ContactHistoryPanel.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { listForTitle } from "@/lib/pricing/contact-log";
import { listContactsForTitle } from "@/lib/pricing/contacts";
import {
  addContactLogAction,
  deleteContactLogAction,
  recordOfferFromContactAction,
} from "@/app/price-actions";
import { SubmitButton } from "@/components";

const CHANNELS = ["EMAIL", "PHONE", "WEB_FORM", "LINKEDIN", "OTHER"] as const;

export async function ContactHistoryPanel({
  locale,
  titleId,
}: {
  locale: string;
  titleId: string;
}) {
  const t = await getTranslations({ locale, namespace: "contactLog" });
  const [entries, contacts, products] = await Promise.all([
    listForTitle(titleId),
    listContactsForTitle(titleId),
    prisma.product.findMany({
      where: { titleId, active: true },
      select: { id: true, name: true, currency: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <article className="card" style={{ marginTop: 16 }}>
      <h2>{t("title")}</h2>

      {entries.length === 0 && <p className="muted small">{t("empty")}</p>}

      {entries.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
          {entries.map((e) => (
            <li
              key={e.id}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--border, #e5e7eb)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <strong>
                    {e.direction === "OUTBOUND" ? "→ " : "← "}
                    {t(`channel${e.channel}`)}
                  </strong>{" "}
                  <span className="muted small">
                    {t(e.direction === "OUTBOUND" ? "outbound" : "inbound")} ·{" "}
                    {e.contactedAt.toISOString().slice(0, 10)}
                    {e.salesContact ? ` · ${e.salesContact.name}` : ""}
                  </span>
                  {e.note && <div className="small" style={{ marginTop: 4 }}>{e.note}</div>}
                </div>
                <form action={deleteContactLogAction} style={{ flexShrink: 0 }}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="titleId" value={titleId} />
                  <input type="hidden" name="id" value={e.id} />
                  <SubmitButton label={t("delete")} pendingLabel={t("deleting")} className="btn small" />
                </form>
              </div>

              {e.quotes.length > 0 && (
                <ul style={{ listStyle: "none", padding: "8px 0 0 16px", margin: 0 }}>
                  {e.quotes.map((q) => (
                    <li key={q.id} className="small muted">
                      └─ {q.product?.name ?? q.draftProductName ?? "—"}: {q.price.toString()} {q.currency}
                      {q.includedText ? ` · ${t("included")}: ${q.includedText}` : ""}
                      {q.excludedText ? ` · ${t("excluded")}: ${q.excludedText}` : ""}
                      {" · "}
                      {q.appliedAt ? t("applied") : t("pending")}
                    </li>
                  ))}
                </ul>
              )}

              <details style={{ marginTop: 8 }}>
                <summary className="muted small" style={{ cursor: "pointer" }}>
                  {t("recordOffer")}
                </summary>
                <form action={recordOfferFromContactAction} className="product-form" style={{ marginTop: 8 }}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="titleId" value={titleId} />
                  <input type="hidden" name="contactLogId" value={e.id} />
                  <div className="field">
                    <label>{t("product")}</label>
                    <select name="productId">
                      <option value="">{t("draftHint")}</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>{t("price")}</label>
                    <input name="price" type="number" step="0.01" required />
                  </div>
                  <div className="field">
                    <label>{t("currency")}</label>
                    <input name="currency" defaultValue={products[0]?.currency ?? "NOK"} required />
                  </div>
                  <div className="field">
                    <label>{t("included")}</label>
                    <textarea name="includedText" />
                  </div>
                  <div className="field">
                    <label>{t("excluded")}</label>
                    <textarea name="excludedText" />
                  </div>
                  <div className="field">
                    <label>{t("validUntil")}</label>
                    <input name="validUntil" type="date" />
                  </div>
                  <SubmitButton label={t("save")} pendingLabel={t("saving")} className="btn small" />
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}

      <details style={{ marginTop: 16 }}>
        <summary className="muted" style={{ cursor: "pointer" }}>{t("addNew")}</summary>
        <form action={addContactLogAction} className="product-form" style={{ marginTop: 12 }}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="titleId" value={titleId} />
          <div className="field">
            <label htmlFor="cl-channel">{t("channel")}</label>
            <select id="cl-channel" name="channel" required>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{t(`channel${c}`)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cl-direction">{t("direction")}</label>
            <select id="cl-direction" name="direction" defaultValue="OUTBOUND">
              <option value="OUTBOUND">{t("outbound")}</option>
              <option value="INBOUND">{t("inbound")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="cl-date">{t("date")}</label>
            <input id="cl-date" name="contactedAt" type="date" />
          </div>
          <div className="field">
            <label htmlFor="cl-contact">{t("contact")}</label>
            <select id="cl-contact" name="salesContactId">
              <option value="">{t("noContact")}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cl-note">{t("note")}</label>
            <textarea id="cl-note" name="note" />
          </div>
          <SubmitButton label={t("save")} pendingLabel={t("saving")} className="btn small" />
        </form>
      </details>
    </article>
  );
}
```

> Note: `listContactsForTitle` returns the title's attached contacts with `id/name/email` (used by `SalesContactsPanel`). If its return shape lacks `email`, use `{c.name}` only in the option label.

- [ ] **Step 3: Mount the panel on the title detail page**

In `src/app/[locale]/desk/titles/[id]/page.tsx`, add the import after line 12:

```ts
import { ContactHistoryPanel } from "./_components/ContactHistoryPanel";
```

And mount it after the `PendingQuotesPanel` (line ~200):

```tsx
      <ContactHistoryPanel locale={locale} titleId={title.id} />
```

- [ ] **Step 4: Typecheck + build the messages**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/desk/titles/[id]/_components/ContactHistoryPanel.tsx" "src/app/[locale]/desk/titles/[id]/page.tsx" src/messages/en.json
git commit -m "feat(pricing): contact history panel + en strings"
```

---

## Task 6: Translations (no, sv, da, de, fi)

**Files:**
- Modify: `src/messages/no.json`, `src/messages/sv.json`, `src/messages/da.json`, `src/messages/de.json`, `src/messages/fi.json`

- [ ] **Step 1: Add the `contactLog` namespace to each locale**

Use natural native copy (not literal calques). Norwegian (`no.json`):

```json
"contactLog": {
  "title": "Kontakthistorikk",
  "empty": "Ingen kontakt logget ennå.",
  "addNew": "Logg en kontakt",
  "channel": "Kanal",
  "direction": "Retning",
  "outbound": "Vi tok kontakt",
  "inbound": "De svarte",
  "date": "Dato",
  "contact": "Salgskontakt (valgfritt)",
  "noContact": "— ingen —",
  "note": "Notat",
  "save": "Lagre",
  "saving": "Lagrer…",
  "delete": "Slett",
  "deleting": "Sletter…",
  "recordOffer": "Registrer tilbud",
  "product": "Produkt (valgfritt)",
  "draftHint": "La produkt stå tomt for et fritekst-tilbud.",
  "price": "Pris",
  "currency": "Valuta",
  "included": "Hva som er inkludert",
  "excluded": "Hva som ikke er inkludert",
  "validUntil": "Gyldig til",
  "applied": "Lagt inn i katalogen",
  "pending": "Venter",
  "channelEMAIL": "E-post",
  "channelPHONE": "Telefon",
  "channelWEB_FORM": "Webskjema",
  "channelLINKEDIN": "LinkedIn",
  "channelOTHER": "Annet"
}
```

Translate the same keys for `sv`, `da`, `de`, `fi` (Swedish, Danish, German, Finnish). Keep keys identical; translate values only. Match the tone of existing strings in each file.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/messages/no.json src/messages/sv.json src/messages/da.json src/messages/de.json src/messages/fi.json
git commit -m "i18n(pricing): contact log strings for no/sv/da/de/fi"
```

---

## Final verification

- [ ] Run `pnpm typecheck` → PASS
- [ ] Run `pnpm test` → all tests pass (the integration test self-skips without `RUN_DB_IT=1`)
- [ ] If a disposable DB is available: `RUN_DB_IT=1 pnpm test` → contact-log integration tests pass
- [ ] Run `pnpm build` → succeeds (validates the new route/page compiles)
- [ ] Manual smoke (optional, requires running app on the project's configured port): open `/<locale>/desk/titles/<id>` as SUPERADMIN, log an OUTBOUND email, record an offer under it, verify it appears nested, delete the entry and confirm the offer persists in the pending-quotes flow.

---

## Self-review notes (spec coverage)

- Spec §1 data model → Task 1. ✅
- Spec §2 lib layer → Task 3 (`contact-log.ts`) + `logQuote` extension. ✅
- Spec §3 server actions → Task 4 (4 actions). ✅
- Spec §4 desk UI panel + i18n → Task 5 (panel, mount, en) + Task 6 (other locales). ✅
- Spec §5 Chrome integration → operational; uses `createContactLog`/`addContactLogAction` from Task 3/4. No extra build task. ✅
- Spec §6 testing → Task 2/3 integration test; final verification. ✅
- Non-goals (last-contacted column, threading, IMAP, per-publisher) correctly excluded. ✅
