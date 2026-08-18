# Campaign programmes (multi-wave planning) — design

**Date:** 2026-08-18
**Status:** approved (Andreas, "guided programme" ambition level)

## Problem

Native advertising works through repetition: several placements over
weeks/months, each with a *fresh* article angle, in a stable core of titles
plus a few new ones for reach. NativeSpin today models exactly one shot:
`SavedList → Request → Quote → Order`. Nothing links a second run to the first,
nothing tells the buyer *when* to come back, `duplicatePlan` copies only
product ids + quantities, and a finished order silently drops off Home.

Worse, the date pipeline is broken: buyers set `SavedListItem.scheduleStart /
scheduleUnits`, but `snapshotListToPlanData` drops them, `Plan.startDate /
endDate` are never written, so `Order.flightStartDate/EndDate` are null on
every self-serve order unless the desk types them in.

## Goal

Let a buyer build a **programme**: N waves of the same campaign, spaced by a
recommended cadence, each wave with its own article angle, each wave submitted
through the existing chain when its date approaches. Recommend sensible
defaults with a stated rationale. Nudge the buyer when the next wave is due.

Non-goals (explicitly deferred): automatic submission of wave 2..N, calendar
view, frequency caps, budget pacing across waves.

## Design

### 1. Date pipeline fix (prerequisite)

- `snapshotListToPlanData` also returns `scheduleStart`, `scheduleUnits`
  (nullable) — `PlanItem` gains the same two nullable columns.
- New pure helper `planWindowFromItems(items, products)` in
  `src/lib/campaign-schedule.ts`: for each item with a schedule, end =
  start + units × (7 days | 1 month) in the product's `bookingUnit`;
  returns `{start: min, end: max}` or nulls when nothing is scheduled.
- `submitRequest` (RFQ path) and `createFirmOrder` write `Plan.startDate /
  endDate` from that helper. `Order.flightStart/End` then populate via the
  existing `plan.startDate ?? null` copy. Desk `saveFlightWindow` still
  overrides.

### 2. Data model

```prisma
model CampaignProgramme {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(...)
  name           String
  plannedWaves   Int
  spacingWeeks   Int
  // i18n key of the rationale shown to the buyer (never free prose from an LLM)
  rationaleKey   String?
  createdById    String?
  archivedAt     DateTime?
  createdAt / updatedAt
  waves SavedList[]
  @@index([organizationId, archivedAt])
}

// on SavedList
programmeId  String?
programme    CampaignProgramme? @relation(fields: [programmeId], references: [id], onDelete: SetNull)
waveNumber   Int?      // 1-based within the programme
articleAngle String?   // the wave's editorial angle, buyer-editable
@@unique([programmeId, waveNumber])
```

A wave *is* a SavedList; nothing downstream changes. `Request.sourceListId`
already links each order chain back to its wave.

`articleAngle` is folded into `Request.briefSummary` on submit as
`Article angle (wave N of M): …` so the desk and writers see it.

### 3. Domain module `src/lib/programme.ts`

Pure (unit-tested, no DB):

- `recommendCadence(input)` → `CadencePlan`
  ```ts
  input: { goal: string|null; bookingUnits: BookingUnit[]; itemCount: number }
  CadencePlan: { waves: number; spacingWeeks: number; rationaleKey: string;
                 angles: AngleKey[] }   // AngleKey = "problem"|"proof"|"howto"|"comparison"
  ```
  Rules (documented in `docs/campaign-cadence.md`):
  - default **3 waves**, **6 weeks** apart, angle sequence problem → proof → how-to
  - any MONTH-unit product → spacing 8 weeks (≈ two issues, snaps to publication cycle) — `rationaleKey: "monthlyCycle"`
  - all WEEK-unit products → spacing 4 weeks — `"weeklyCycle"`
  - goal contains launch/lansering/launch-like → 4 waves, min(spacing, 4) — `"launch"`
  - goal contains awareness/kjennskap/brand → spacing +2 weeks — `"awareness"`
  - else `"default"`
- `planWaveDates(firstStart: Date|null, waves, spacingWeeks, unit)` → array of
  wave anchor dates, each snapped to the period grid via
  `upcomingPeriods` semantics (Monday / first-of-month, UTC).
- `shiftSchedule(item, weeks, unit)` → new `scheduleStart` for a copied item.

DB (integration-tested behind `RUN_DB_IT`):

- `createProgramme({ sourceListId, orgId, userId, waves, spacingWeeks, angles, name })`
  - transaction: create `CampaignProgramme`; attach source list as wave 1
    (`programmeId`, `waveNumber = 1`, `articleAngle = angles[0]`); for waves
    2..N create a full copy of the source list — name `"<name> · Wave k"`,
    all list-level fields (budget, currency, goal, audienceNote, targetGeo/
    Audience/Context, targetVerticals, note), all items incl.
    withContent/authorshipMode/notes/sortOrder, schedule shifted by
    `(k-1) × spacingWeeks` when the source item has one.
  - refuses if the source list is already in a programme (`ProgrammeError`).
  - returns programme id + wave list ids.
- `loadProgrammeForList(listId)` → `{ programme, waves: [{id, waveNumber, name, articleAngle, scheduleStart, sent: boolean, orderStatus }] }` for the plan header.
- `findDueWaves(orgIds, now)` → wave lists that are unsent whose previous
  wave has an order in LIVE/COMPLETED/INVOICED (or whose earliest
  scheduleStart is within 21 days). Feeds Home.
- `setWaveAngle(listId, angle)`.

### 4. Server actions (thin shells, `src/app/programme-actions.ts`)

- `startProgramme(formData)` — fields: locale, listId, waves, spacingWeeks,
  angle_1..angle_N. Auth via `requireActiveOrg` + `canActOnOrg`. Calls
  `createProgramme`, audit `programme.create`, redirect
  `/plan?programme=created`.
- `updateWaveAngle(formData)` — listId, angle → `setWaveAngle`, redirect `/plan`.
- `startProgrammeFromOrder(formData)` — replaces `duplicatePlan`'s body:
  full copy of the order's source list (or plan if list is gone) into a new
  list, then redirects to `/plan?duplicate=ok` with the programme panel open.
  `duplicatePlan` keeps its export name; it becomes a full copy (fixes the
  stub) and preserves the existing `?duplicate=` banners.

### 5. UI

**/plan — `PlanProgramme.tsx`** (server component, native `<details>` like
`PlanTargeting`), rendered between `PlanTargeting` and the split:

- Not in a programme: summary "Run this as a programme — 3 waves, 6 weeks
  apart (recommended)". Open: waves radio (1–4), spacing select (2/4/6/8/12
  weeks), per-wave angle input pre-filled from `recommendCadence`, one-line
  rationale, explainer text ("why waves, why fresh articles, keep core
  titles + add reach"), submit `startProgramme`.
- In a programme: wave strip "Wave 2 of 3 · from 6 Oct" with each wave's
  status (draft / sent / live / done), links to switch to a wave
  (`selectActiveList`), and this wave's angle as an editable field.
- Wave lists ≥2 also carry a header line in `PlanTitleBlock` (`waveLabel`).
- On submit (`PlanSummary` form) the angle is included as a hidden input
  `articleAngle` and folded into the brief.

**/requests** — draft rows in a programme get `footerNote` "Wave 2 of 3 ·
scheduled from 6 Oct" ; `deriveStage` unchanged but `stageLabels[4]` reads
"Live / done"; rows whose order is COMPLETED/INVOICED get footerNote
"Finished · next wave: …" when applicable.

**Home** — new needs-you card kind "Next wave due" (icon `Repeat`) per due
wave: title = programme name, desc = "Wave 2 of 3 · angle · from 6 Oct",
CTA "Open wave" (form → `selectActiveList`). "Repeat a past campaign"
button now points to `/requests?tab=done` (where each finished order row
offers "Plan next wave" via `duplicatePlan`).

**Order completed** — `advanceOrder` reaching COMPLETED sends
`NotificationKind.ORDER_COMPLETED` via `notifyOrg` (this already emails):
title "Campaign finished: <plan>", body with next-wave suggestion and link
to `/plan` (wave list selected) or to the order when no programme.

### 6. Copy / i18n

New keys under `plan.programme.*`, `buyerHome.nextWave*`,
`requests.waveNote*`, `notifications.orderCompleted*` in en.json first, then
no/sv/da/fi/de. Locale-parity test enforces completeness.

### 7. Docs

`docs/campaign-cadence.md` — the recommendation rules and the reasoning
(repetition, wear-out, core+reach title mix), single source of truth for
`recommendCadence`.

## Testing

- `src/lib/programme.test.ts` — recommendCadence rules, planWaveDates snapping,
  shiftSchedule.
- `src/lib/campaign-schedule.test.ts` — planWindowFromItems.
- `src/lib/programme.it.test.ts` — createProgramme copies everything, unique
  wave numbers, refuses double-enrol; findDueWaves.
- `src/messages/locale-parity.test.ts` unchanged, must pass.
- `tsc`, `pnpm test`, `pnpm build`, browser check on prod after deploy.

## Rollout

Single migration (additive: 1 table, 2 PlanItem cols, 3 SavedList cols).
No feature flag: the panel is collapsed by default and opt-in.
