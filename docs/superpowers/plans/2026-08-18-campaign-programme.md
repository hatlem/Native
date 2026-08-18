# Campaign Programme (multi-wave) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a buyer turn a plan into an N-wave programme (recommended cadence + one article angle per wave), get nudged when the next wave is due, and have real flight dates flow from list schedule → Plan → Order.

**Architecture:** A wave is a `SavedList`; a new `CampaignProgramme` groups waves (`SavedList.programmeId/waveNumber/articleAngle`). Pure cadence rules live in `src/lib/programme.ts`; DB work in the same module (tested `.it.test.ts`); thin `"use server"` shells in `src/app/programme-actions.ts`. UI: `PlanProgramme` panel on /plan, wave notes on /requests, "Next wave due" card on Home, `ORDER_COMPLETED` notification on desk advance.

**Tech Stack:** Next.js App Router (server components + server actions), Prisma/Postgres, next-intl (6 locales, parity test), node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-08-18-campaign-programme-design.md`

## Global Constraints

- Copy is written in `src/messages/en.json` first, then mirrored into `no,sv,da,fi,de` — `src/messages/locale-parity.test.ts` fails otherwise and next-intl throws at render on a missing key.
- Server actions are never unit-tested directly; logic goes in `src/lib/*` and is tested there. Server actions stay thin auth+redirect shells.
- Never render emails as SSR text (Cloudflare obfuscation) — n/a here but keep in mind for notification copy.
- Same-route soft-nav is broken in prod: use `<form action>` posts and full navigations, not `router.replace`.
- Migrations run on deploy from `main`; migration must be additive.
- `pnpm test`, `npx tsc --noEmit`, `pnpm build` must be green before each commit that touches TS.
- Prod verification via browser after deploy (`Monitor` on Railway deploy of the commit).

---

## File map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + `prisma/migrations/20260818120000_campaign_programme/migration.sql` | `CampaignProgramme`, `SavedList.programmeId/waveNumber/articleAngle`, `PlanItem.scheduleStart/scheduleUnits`, `NotificationKind.ORDER_COMPLETED` |
| `src/lib/campaign-schedule.ts` (+ `.test.ts`) | `planWindowFromItems`, `addPeriods` |
| `src/lib/lists.ts` | `snapshotListToPlanData` carries schedule; `copyListData` helper |
| `src/app/checkout-actions.ts`, `src/lib/commerce/firm-order.ts` | write `Plan.startDate/endDate`; fold `articleAngle` into brief |
| `src/lib/programme.ts` (+ `.test.ts`, `.it.test.ts`) | `recommendCadence`, `planWaveDates`, `shiftScheduleStart`, `createProgramme`, `loadProgrammeForList`, `findDueWaves`, `setWaveAngle`, `programmeCopyFromOrder` |
| `src/app/programme-actions.ts` | `startProgramme`, `updateWaveAngle` |
| `src/app/plan-actions.ts` | `duplicatePlan` → full copy via `programmeCopyFromOrder` |
| `src/app/[locale]/plan/_components/PlanProgramme.tsx` | the panel + wave strip |
| `src/app/[locale]/plan/page.tsx` | mounts `PlanProgramme`; passes `articleAngle` to `PlanSummary` |
| `src/app/[locale]/plan/_components/PlanSummary.tsx` | hidden `articleAngle` input |
| `src/app/[locale]/requests/page.tsx` | wave footer notes |
| `src/app/[locale]/home/page.tsx` | "Next wave due" cards; `startRepeat` → `/requests?tab=done` |
| `src/app/[locale]/orders/[orderId]/page.tsx` | button copy "Plan next wave" |
| `src/app/desk-actions.ts` | `ORDER_COMPLETED` notification |
| `src/messages/*.json` | copy |
| `src/app/globals.css` | `.plan-programme*`, `.wave-strip*` |
| `docs/campaign-cadence.md` | rules rationale |

---

### Task 1: Schema + migration

**Files:** `prisma/schema.prisma`, `prisma/migrations/20260818120000_campaign_programme/migration.sql`

- [ ] Add to `NotificationKind` (after `PLACEMENT_PROPOSED`): `ORDER_COMPLETED` with comment "Order reached COMPLETED — buyer's cue to plan the next wave."
- [ ] Add to `PlanItem`: `scheduleStart DateTime?`, `scheduleUnits Int?` (comment: snapshot of SavedListItem schedule; drives Plan.startDate/endDate).
- [ ] Add model after `SavedList`:
```prisma
// A multi-wave campaign: N SavedLists (waves) sharing titles/targeting, spaced
// by `spacingWeeks`, each with its own article angle. Waves submit through the
// normal SavedList → Request → Order chain one at a time.
model CampaignProgramme {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  name           String
  plannedWaves   Int
  spacingWeeks   Int
  // i18n key under plan.programme.rationale.* — never LLM prose.
  rationaleKey   String?
  createdById    String?
  archivedAt     DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  waves SavedList[]

  @@index([organizationId, archivedAt])
}
```
- [ ] Add to `SavedList`: `programmeId String?`, `programme CampaignProgramme? @relation(fields: [programmeId], references: [id], onDelete: SetNull)`, `waveNumber Int?`, `articleAngle String?`, `@@unique([programmeId, waveNumber])`. Add `programmes CampaignProgramme[]` to `Organization`.
- [ ] Migration SQL:
```sql
ALTER TYPE "NotificationKind" ADD VALUE 'ORDER_COMPLETED';
ALTER TABLE "PlanItem" ADD COLUMN "scheduleStart" TIMESTAMP(3), ADD COLUMN "scheduleUnits" INTEGER;
CREATE TABLE "CampaignProgramme" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "plannedWaves" INTEGER NOT NULL, "spacingWeeks" INTEGER NOT NULL,
  "rationaleKey" TEXT, "createdById" TEXT, "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignProgramme_pkey" PRIMARY KEY ("id"));
CREATE INDEX "CampaignProgramme_organizationId_archivedAt_idx" ON "CampaignProgramme"("organizationId","archivedAt");
ALTER TABLE "CampaignProgramme" ADD CONSTRAINT "CampaignProgramme_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SavedList" ADD COLUMN "programmeId" TEXT, ADD COLUMN "waveNumber" INTEGER, ADD COLUMN "articleAngle" TEXT;
CREATE UNIQUE INDEX "SavedList_programmeId_waveNumber_key" ON "SavedList"("programmeId","waveNumber");
ALTER TABLE "SavedList" ADD CONSTRAINT "SavedList_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "CampaignProgramme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```
- [ ] `npx prisma generate`, `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url ...` is not available (no local DB) → sanity check by `npx prisma validate` and reading the SQL against schema by hand.
- [ ] Commit `feat(schema): campaign programme, plan item schedule, ORDER_COMPLETED`.

### Task 2: Date pipeline

**Files:** `src/lib/campaign-schedule.ts`, `src/lib/campaign-schedule.test.ts`, `src/lib/lists.ts`, `src/app/checkout-actions.ts`, `src/lib/commerce/firm-order.ts`

**Produces:**
```ts
export function addPeriods(start: Date, units: number, unit: BookingUnit): Date // exclusive end
export function planWindowFromItems(items: Array<{scheduleStart: Date|null; scheduleUnits: number|null; bookingUnit: BookingUnit}>): {start: Date|null; end: Date|null}
```
`snapshotListToPlanData` input/outputs gain `scheduleStart: Date|null; scheduleUnits: number|null`.
`createFirmOrder` items gain optional `scheduleStart?: Date|null; scheduleUnits?: number|null`, and `FirmOrderProduct` gains `bookingUnit: BookingUnit`.

- [ ] Tests (node:test): addPeriods WEEK 2 → +14d; MONTH 1 from 2026-01-01 → 2026-02-01; planWindow: no schedules → nulls; mixed → min start, max end.
- [ ] Implement; wire in `submitRequest` RFQ branch (`startDate/endDate` on `tx.plan.create`) and in `createFirmOrder` (`plan.create` data + item snapshot).
- [ ] `pnpm test`, tsc. Commit `fix(plan): carry item schedule into Plan/Order flight window`.

### Task 3: `src/lib/programme.ts` pure part

**Produces:**
```ts
export type AngleKey = "problem" | "proof" | "howto" | "comparison";
export const ANGLE_KEYS: AngleKey[]
export type CadencePlan = { waves: number; spacingWeeks: number; rationaleKey: "default"|"monthlyCycle"|"weeklyCycle"|"launch"|"awareness"; angles: AngleKey[] };
export function recommendCadence(input: { goal: string|null; bookingUnits: BookingUnit[] }): CadencePlan
export function planWaveDates(firstStart: Date|null, waves: number, spacingWeeks: number, unit: BookingUnit, base: Date): Array<Date|null>
export function shiftScheduleStart(start: Date, weeks: number, unit: BookingUnit): Date
export function anglesFor(waves: number, cadence: CadencePlan): AngleKey[]  // repeats/cycles sequence to length
export const SPACING_OPTIONS = [2,4,6,8,12] as const; export const WAVE_OPTIONS = [2,3,4] as const;
export function clampCadence(waves: number, spacingWeeks: number): {waves:number; spacingWeeks:number}
```
Rules per spec §3. `shiftScheduleStart` for MONTH: add `round(weeks/4.33)` months, snap to first-of-month; WEEK: add weeks (Monday preserved). `planWaveDates` uses `firstStart ?? upcomingPeriods(unit,1,base)[0]`.

- [ ] Write `src/lib/programme.test.ts` covering each rule + snapping + clampCadence bounds.
- [ ] Implement, `pnpm test`, commit `feat(programme): cadence recommendation rules`.

### Task 4: `src/lib/programme.ts` DB part + `.it.test.ts`

**Produces:**
```ts
export class ProgrammeError extends Error { code: "already-in-programme"|"not-found"|"empty" }
export async function createProgramme(input: { sourceListId: string; organizationId: string; userId: string|null; waves: number; spacingWeeks: number; angles: string[]; rationaleKey: string|null }): Promise<{ programmeId: string; waveListIds: string[] }>
export type ProgrammeView = { id: string; name: string; plannedWaves: number; spacingWeeks: number; rationaleKey: string|null; waves: Array<{ listId: string; waveNumber: number; name: string; articleAngle: string|null; scheduleStart: Date|null; state: "draft"|"sent"|"quoted"|"booked"|"live"|"done" }> }
export async function loadProgrammeForList(listId: string): Promise<ProgrammeView|null>
export async function findDueWaves(orgIds: string[], now: Date): Promise<Array<{ listId: string; programmeName: string; waveNumber: number; plannedWaves: number; articleAngle: string|null; scheduleStart: Date|null; reason: "previous-live"|"previous-done"|"date-near" }>>
export async function setWaveAngle(listId: string, angle: string|null): Promise<void>
export async function copyListForNewWave(source: SavedListWithItems, opts: {name: string; shiftWeeks: number; unitByProductId: Map<string,BookingUnit>; programmeId?: string; waveNumber?: number; articleAngle?: string|null; createdById: string|null}, tx: Prisma.TransactionClient): Promise<string>
export async function sourceListForOrder(orderId: string): Promise<{ list: SavedListWithItems } | { planItems: ... } | null>
```
State derivation per wave: latest Request for `sourceListId` → latest quote → order: no request = draft; request no quote = sent; quote no order = quoted; order CONFIRMED/IN_PRODUCTION/SCHEDULED = booked; LIVE = live; COMPLETED/INVOICED = done. Reuse `deriveStage` where possible.

`findDueWaves`: for each org's non-archived programme, take waves ordered; a wave is due if it is draft AND (previous wave state ∈ live/done OR scheduleStart within 21 days of `now`). Wave 1 never "due" (it's just a draft).

- [ ] Write `.it.test.ts` (gated `RUN_DB_IT`): createProgramme copies budget/currency/goal/targeting/targetVerticals/items/withContent/schedule shifted; wave numbers 1..N; second createProgramme on same list throws `already-in-programme`; findDueWaves returns wave 2 once wave 1 has a LIVE order.
- [ ] Implement, tsc, commit `feat(programme): create/load/due-wave domain logic`.

### Task 5: Server actions + duplicatePlan fix

**Files:** `src/app/programme-actions.ts` (new), `src/app/plan-actions.ts`

- [ ] `startProgramme(formData)`: locale, listId, waves, spacingWeeks, `angle` (getAll, one per wave). `loadScope`; list must exist and `canActOnOrg`; `clampCadence`; `createProgramme`; `recordAudit(userId,"programme.create",...)`; `writeActiveListId(listId)`; redirect `/${locale}/plan?programme=created`. On `ProgrammeError` redirect `/plan?programme=<code>`.
- [ ] `updateWaveAngle(formData)`: listId, angle (≤300 chars) → `setWaveAngle`, redirect `/plan`.
- [ ] `duplicatePlan`: use `sourceListForOrder`; if a source list exists → `copyListForNewWave` with name `"<list.name> · next wave"`, no programme; else fall back to plan-items copy (existing behaviour, but also copies withContent/authorshipMode/notes). Keep `?duplicate=` banners.
- [ ] tsc, commit `feat(programme): server actions; duplicatePlan copies everything`.

### Task 6: /plan UI

**Files:** `PlanProgramme.tsx` (new), `plan/page.tsx`, `PlanSummary.tsx`, `PlanBanners.tsx`, `globals.css`, `checkout-actions.ts` (fold `articleAngle` into brief), messages.

- [ ] `PlanProgramme` props: `{ locale, listId, listName, view: ProgrammeView|null, cadence: CadencePlan, firstStart: Date|null, unit: BookingUnit }`. Not-in-programme → `<details class="plan-programme">` with recommendation summary and form (`startProgramme`): waves radios (2/3/4, default cadence.waves), spacing select, N angle inputs (default `t(\`angle.${key}\`)`), rationale line `t(\`rationale.${cadence.rationaleKey}\`)`, explainer `<ul>` (3 bullets), submit. In-programme → wave strip: each wave chip shows "Wave k", name, state badge, date, angle; current wave highlighted; other waves are `<form action={selectActiveList}>` buttons; angle editable form (`updateWaveAngle`) for the current wave.
- [ ] page.tsx: load `loadProgrammeForList(activeList.id)`, `recommendCadence({goal: activeList.goal, bookingUnits})`, `firstStart` = min item scheduleStart; mount after `PlanTargeting`. Pass `articleAngle={activeList.articleAngle}` to `PlanSummary` → hidden input.
- [ ] `submitRequest` + `createFirmOrder` brief: prepend `Article angle (wave N of M): <angle>` when list has programme.
- [ ] Banner `plan.programmeCreated`.
- [ ] Copy en + 5 locales. tsc, test, build. Commit `feat(plan): programme panel + wave strip`.

### Task 7: /requests + Home + order page + desk notification

- [ ] `requests/page.tsx`: `loadUnsentLists` include `programme` + waveNumber/articleAngle/min scheduleStart → footerNote `t("waveNote", {n, of, date})`; request rows with `sourceList.programme` and order done → footerNote `t("waveDoneNote", ...)`. `stageLive` label → "Live / done".
- [ ] `home/page.tsx`: `findDueWaves(orgIds, new Date())` → cards (icon `Repeat`, class `home-needs-card--accent`), CTA form `selectActiveList` → /plan; heading counts include due waves. `startRepeat` href → `/requests?tab=done`.
- [ ] `orders/[orderId]/page.tsx`: button label `orders.useAsTemplate` → "Plan next wave" (all locales), keep action.
- [ ] `desk-actions.ts` `advanceOrder`: when `next === "COMPLETED"` send `notifyOrg(kind:"ORDER_COMPLETED", title, body, link)`; link = `/${locale}/plan` if a due wave exists for that org else `/${locale}/orders/${id}`; body suggests next wave. Other transitions unchanged.
- [ ] Copy all locales; tsc/test/build; commit `feat(programme): due-wave nudges on home/requests, completion notice`.

### Task 8: Docs + deploy + verify

- [ ] `docs/campaign-cadence.md` (rules + why). Commit `docs: campaign cadence rules`.
- [ ] Push; monitor Railway deploy; verify in browser: /plan panel renders + create programme with test buyer; /requests shows wave notes; Home card once wave 1 has an order (or verify via unit paths). Fix anything found.
