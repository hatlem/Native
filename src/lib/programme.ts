// Campaign programmes — multi-wave planning.
//
// A programme is N SavedLists ("waves") sharing titles + targeting, spaced by
// a cadence, each with its own article angle. Everything downstream of a list
// (Request → Quote → Order) is untouched: a wave submits like any list.
//
// The cadence rules here are the single source of truth for what we
// recommend — documented for humans in docs/campaign-cadence.md. Keep the two
// in sync. Deterministic on purpose: the rationale shown to the buyer is an
// i18n key, never model prose.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deriveStage } from "@/lib/campaign-stage";
import { upcomingPeriods, type BookingUnit } from "@/lib/campaign-schedule";

// ---------- pure: cadence recommendation ----------

export type AngleKey = "problem" | "proof" | "howto" | "comparison";
export const ANGLE_KEYS: readonly AngleKey[] = ["problem", "proof", "howto", "comparison"];

export type RationaleKey = "default" | "monthlyCycle" | "weeklyCycle" | "launch" | "awareness";

export type CadencePlan = {
  waves: number;
  spacingWeeks: number;
  rationaleKey: RationaleKey;
  angles: AngleKey[];
};

export const WAVE_OPTIONS = [2, 3, 4] as const;
export const SPACING_OPTIONS = [2, 4, 6, 8, 12] as const;

const DEFAULT_WAVES = 3;
const DEFAULT_SPACING = 6;

// Goal phrasing that signals a launch / awareness intent across the six UI
// languages. Substring match on the lower-cased goal — good enough for a
// default; the buyer can always override the numbers.
const LAUNCH_HINTS = ["launch", "lanser", "lansier", "lanseer", "einführung", "introduc"];
const AWARENESS_HINTS = ["awareness", "kjennskap", "kännedom", "kendskab", "tunnettuu", "bekanntheit", "brand", "merkevare", "varumärke"];

function hasHint(goal: string | null, hints: string[]): boolean {
  if (!goal) return false;
  const g = goal.toLowerCase();
  return hints.some((h) => g.includes(h));
}

/**
 * Recommend a wave count + spacing + angle sequence for a plan.
 *
 * Rules (see docs/campaign-cadence.md):
 *  - default: 3 waves, 6 weeks apart, angles problem → proof → how-to
 *  - any MONTH-unit title: 8 weeks (two issues of a monthly) — "monthlyCycle"
 *  - all WEEK-unit titles: 4 weeks — "weeklyCycle"
 *  - launch goal: 4 waves, spacing capped at 4 weeks — "launch"
 *  - awareness/brand goal: spacing +2 weeks — "awareness"
 * Launch beats awareness when both match (a launch has a date; awareness doesn't).
 */
export function recommendCadence(input: { goal: string | null; bookingUnits: BookingUnit[] }): CadencePlan {
  let waves = DEFAULT_WAVES;
  let spacingWeeks = DEFAULT_SPACING;
  let rationaleKey: RationaleKey = "default";

  const units = input.bookingUnits;
  if (units.some((u) => u === "MONTH")) {
    spacingWeeks = 8;
    rationaleKey = "monthlyCycle";
  } else if (units.length > 0 && units.every((u) => u === "WEEK")) {
    spacingWeeks = 4;
    rationaleKey = "weeklyCycle";
  }

  if (hasHint(input.goal, LAUNCH_HINTS)) {
    waves = 4;
    spacingWeeks = Math.min(spacingWeeks, 4);
    rationaleKey = "launch";
  } else if (hasHint(input.goal, AWARENESS_HINTS)) {
    spacingWeeks += 2;
    rationaleKey = "awareness";
  }

  const clamped = clampCadence(waves, spacingWeeks);
  const base: CadencePlan = { ...clamped, rationaleKey, angles: [] };
  return { ...base, angles: anglesFor(clamped.waves, base) };
}

/** The angle sequence for `waves` waves — cycles ANGLE_KEYS so wave 4 gets "comparison". */
export function anglesFor(waves: number, _cadence: CadencePlan): AngleKey[] {
  return Array.from({ length: waves }, (_, i) => ANGLE_KEYS[i % ANGLE_KEYS.length]);
}

/** Coerce posted numbers onto the offered options (nearest), defaults on garbage. */
export function clampCadence(waves: number, spacingWeeks: number): { waves: number; spacingWeeks: number } {
  const nearest = (v: number, opts: readonly number[], fallback: number) => {
    if (!Number.isFinite(v)) return fallback;
    // Ties round up: more spacing is the safer default against wear-out.
    return opts.reduce((best, o) => (Math.abs(o - v) <= Math.abs(best - v) ? o : best), opts[0]);
  };
  return {
    waves: nearest(waves, WAVE_OPTIONS, DEFAULT_WAVES),
    spacingWeeks: nearest(spacingWeeks, SPACING_OPTIONS, DEFAULT_SPACING),
  };
}

// ---------- pure: wave dates ----------

/** Shift a period anchor by `weeks`, staying on the unit's grid. MONTH rounds
 *  weeks to whole months (min 1) and re-snaps to the 1st. */
export function shiftScheduleStart(start: Date, weeks: number, unit: BookingUnit): Date {
  if (unit === "WEEK") return new Date(start.getTime() + weeks * 7 * 86_400_000);
  const months = Math.max(1, Math.round(weeks / 4.33));
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
}

/** Anchor dates for each wave. Wave 1 = firstStart, or the current period
 *  when the source list has no schedule yet. */
export function planWaveDates(
  firstStart: Date | null,
  waves: number,
  spacingWeeks: number,
  unit: BookingUnit,
  base: Date,
): Array<Date | null> {
  const first = firstStart ?? new Date(`${upcomingPeriods(unit, 1, base)[0].iso}T00:00:00Z`);
  return Array.from({ length: waves }, (_, i) =>
    i === 0 ? first : shiftScheduleStart(first, spacingWeeks * i, unit),
  );
}

// ---------- DB: create / load / due ----------

export class ProgrammeError extends Error {
  constructor(public code: "already-in-programme" | "not-found" | "empty") {
    super(`programme:${code}`);
    this.name = "ProgrammeError";
  }
}

const WAVE_SOURCE_INCLUDE = {
  items: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: { product: { select: { bookingUnit: true } } },
  },
} satisfies Prisma.SavedListInclude;

export type WaveSourceList = Prisma.SavedListGetPayload<{ include: typeof WAVE_SOURCE_INCLUDE }>;

/**
 * Copy a list into a new one — everything the buyer set (budget, currency,
 * goal, targeting, targetVerticals, note) and every item incl. content mode,
 * notes, sort order — with each scheduled item shifted forward by
 * `shiftWeeks` on its product's grid. Optionally enrols the copy in a
 * programme. Runs on the caller's transaction client.
 */
export async function copyListForNewWave(
  source: WaveSourceList,
  opts: {
    name: string;
    shiftWeeks: number;
    programmeId?: string;
    waveNumber?: number;
    articleAngle?: string | null;
    createdById: string | null;
  },
  tx: Prisma.TransactionClient,
): Promise<string> {
  const created = await tx.savedList.create({
    data: {
      organizationId: source.organizationId,
      name: opts.name,
      note: source.note,
      budget: source.budget,
      currency: source.currency,
      goal: source.goal,
      audienceNote: source.audienceNote,
      targetGeo: source.targetGeo,
      targetAudience: source.targetAudience,
      targetContext: source.targetContext,
      targetVerticals: source.targetVerticals,
      programmeId: opts.programmeId ?? null,
      waveNumber: opts.waveNumber ?? null,
      articleAngle: opts.articleAngle ?? null,
      createdById: opts.createdById,
      items: {
        create: source.items.map((i) => ({
          productId: i.productId,
          titleId: i.titleId,
          quantity: i.quantity,
          withContent: i.withContent,
          authorshipMode: i.authorshipMode,
          notes: i.notes,
          sortOrder: i.sortOrder,
          scheduleStart:
            i.scheduleStart && opts.shiftWeeks > 0
              ? shiftScheduleStart(i.scheduleStart, opts.shiftWeeks, i.product?.bookingUnit ?? "MONTH")
              : i.scheduleStart,
          scheduleUnits: i.scheduleUnits,
        })),
      },
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Turn `sourceListId` into wave 1 of a new programme and create waves 2..N as
 * shifted copies. Throws ProgrammeError on a list that's already a wave, is
 * missing, or is empty.
 */
export async function createProgramme(input: {
  sourceListId: string;
  organizationId: string;
  userId: string | null;
  waves: number;
  spacingWeeks: number;
  angles: Array<string | null>;
  rationaleKey: string | null;
}): Promise<{ programmeId: string; waveListIds: string[] }> {
  const { waves, spacingWeeks } = clampCadence(input.waves, input.spacingWeeks);
  const source = await prisma.savedList.findUnique({
    where: { id: input.sourceListId },
    include: WAVE_SOURCE_INCLUDE,
  });
  if (!source || source.organizationId !== input.organizationId || source.archivedAt) {
    throw new ProgrammeError("not-found");
  }
  if (source.programmeId) throw new ProgrammeError("already-in-programme");
  if (source.items.length === 0) throw new ProgrammeError("empty");

  const angle = (k: number) => {
    const a = input.angles[k]?.trim();
    return a ? a.slice(0, 300) : null;
  };
  const baseName = source.name.replace(/\s*·\s*Wave \d+$/i, "");

  return prisma.$transaction(async (tx) => {
    const programme = await tx.campaignProgramme.create({
      data: {
        organizationId: source.organizationId,
        name: baseName,
        plannedWaves: waves,
        spacingWeeks,
        rationaleKey: input.rationaleKey,
        createdById: input.userId,
      },
      select: { id: true },
    });
    await tx.savedList.update({
      where: { id: source.id },
      data: {
        programmeId: programme.id,
        waveNumber: 1,
        articleAngle: angle(0),
        name: `${baseName} · Wave 1`,
      },
    });
    const waveListIds = [source.id];
    for (let k = 2; k <= waves; k++) {
      waveListIds.push(
        await copyListForNewWave(
          source,
          {
            name: `${baseName} · Wave ${k}`,
            shiftWeeks: spacingWeeks * (k - 1),
            programmeId: programme.id,
            waveNumber: k,
            articleAngle: angle(k - 1),
            createdById: input.userId,
          },
          tx,
        ),
      );
    }
    return { programmeId: programme.id, waveListIds };
  });
}

export type WaveState = "draft" | "sent" | "quoted" | "booked" | "live" | "done";

export type ProgrammeView = {
  id: string;
  name: string;
  plannedWaves: number;
  spacingWeeks: number;
  rationaleKey: string | null;
  waves: Array<{
    listId: string;
    waveNumber: number;
    name: string;
    articleAngle: string | null;
    scheduleStart: Date | null;
    state: WaveState;
    orderId: string | null;
    requestId: string | null;
  }>;
};

const WAVE_STATE_INCLUDE = {
  items: { select: { scheduleStart: true } },
  requests: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: {
      id: true,
      status: true,
      quotes: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: { status: true, order: { select: { id: true, status: true } } },
      },
    },
  },
} satisfies Prisma.SavedListInclude;

type WaveRow = Prisma.SavedListGetPayload<{ include: typeof WAVE_STATE_INCLUDE }>;

function waveState(row: WaveRow): { state: WaveState; orderId: string | null; requestId: string | null } {
  const req = row.requests[0];
  if (!req) return { state: "draft", orderId: null, requestId: null };
  const quote = req.quotes[0] ?? null;
  const order = quote?.order ?? null;
  const stage = deriveStage({
    requestStatus: req.status,
    quoteStatus: quote?.status ?? null,
    orderStatus: order?.status ?? null,
  });
  let state: WaveState;
  if (stage <= 2) state = "sent";
  else if (stage === 3) state = "quoted";
  else if (stage === 4) state = "booked";
  else state = order && ["COMPLETED", "INVOICED"].includes(order.status) ? "done" : "live";
  return { state, orderId: order?.id ?? null, requestId: req.id };
}

function earliestStart(items: Array<{ scheduleStart: Date | null }>): Date | null {
  let min: Date | null = null;
  for (const i of items) if (i.scheduleStart && (!min || i.scheduleStart < min)) min = i.scheduleStart;
  return min;
}

function toView(
  p: { id: string; name: string; plannedWaves: number; spacingWeeks: number; rationaleKey: string | null },
  waves: WaveRow[],
): ProgrammeView {
  return {
    id: p.id,
    name: p.name,
    plannedWaves: p.plannedWaves,
    spacingWeeks: p.spacingWeeks,
    rationaleKey: p.rationaleKey,
    waves: waves
      .filter((w) => w.waveNumber != null)
      .sort((a, b) => (a.waveNumber ?? 0) - (b.waveNumber ?? 0))
      .map((w) => ({
        listId: w.id,
        waveNumber: w.waveNumber as number,
        name: w.name,
        articleAngle: w.articleAngle,
        scheduleStart: earliestStart(w.items),
        ...waveState(w),
      })),
  };
}

/** The programme a list belongs to, with every wave's state — null when it's a plain list. */
export async function loadProgrammeForList(listId: string): Promise<ProgrammeView | null> {
  const list = await prisma.savedList.findUnique({ where: { id: listId }, select: { programmeId: true } });
  if (!list?.programmeId) return null;
  const p = await prisma.campaignProgramme.findUnique({
    where: { id: list.programmeId },
    include: { waves: { where: { archivedAt: null }, include: WAVE_STATE_INCLUDE } },
  });
  return p ? toView(p, p.waves) : null;
}

export type DueWave = {
  listId: string;
  programmeId: string;
  programmeName: string;
  waveNumber: number;
  plannedWaves: number;
  articleAngle: string | null;
  scheduleStart: Date | null;
  reason: "previous-live" | "previous-done" | "date-near";
};

const DUE_HORIZON_DAYS = 21;

/**
 * Waves the buyer should act on now: still a draft, and either the previous
 * wave is live/finished or this wave's start is within three weeks. Wave 1 is
 * never "due" (it's just an unsent plan — /requests already shows those).
 */
export async function findDueWaves(orgIds: string[], now: Date): Promise<DueWave[]> {
  if (orgIds.length === 0) return [];
  const programmes = await prisma.campaignProgramme.findMany({
    where: { organizationId: { in: orgIds }, archivedAt: null },
    include: { waves: { where: { archivedAt: null }, include: WAVE_STATE_INCLUDE } },
    orderBy: { createdAt: "desc" },
  });
  const horizon = new Date(now.getTime() + DUE_HORIZON_DAYS * 86_400_000);
  const due: DueWave[] = [];
  for (const p of programmes) {
    const view = toView(p, p.waves);
    for (let i = 1; i < view.waves.length; i++) {
      const w = view.waves[i];
      if (w.state !== "draft") continue;
      const prev = view.waves[i - 1];
      let reason: DueWave["reason"] | null = null;
      if (prev.state === "done") reason = "previous-done";
      else if (prev.state === "live") reason = "previous-live";
      else if (w.scheduleStart && w.scheduleStart <= horizon) reason = "date-near";
      if (!reason) continue;
      due.push({
        listId: w.listId,
        programmeId: view.id,
        programmeName: view.name,
        waveNumber: w.waveNumber,
        plannedWaves: view.plannedWaves,
        articleAngle: w.articleAngle,
        scheduleStart: w.scheduleStart,
        reason,
      });
      break; // one nudge per programme: the next wave only
    }
  }
  return due;
}

export async function setWaveAngle(listId: string, angle: string | null): Promise<void> {
  await prisma.savedList.updateMany({
    where: { id: listId },
    data: { articleAngle: angle && angle.trim() ? angle.trim().slice(0, 300) : null },
  });
}

/**
 * The list an order was submitted from (Request.sourceListId), hydrated for
 * copying — or null when the list is gone/never existed (API orders, or
 * archived-and-purged lists), in which case callers fall back to the Plan.
 */
export async function sourceListForOrder(orderId: string): Promise<WaveSourceList | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { quote: { select: { request: { select: { sourceListId: true } } } } },
  });
  const listId = order?.quote.request.sourceListId;
  if (!listId) return null;
  return prisma.savedList.findUnique({ where: { id: listId }, include: WAVE_SOURCE_INCLUDE });
}
