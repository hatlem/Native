// Campaign programmes — multi-wave planning (DB side).
//
// A programme is N SavedLists ("waves") sharing titles + targeting, spaced by
// a cadence, each with its own article angle. Everything downstream of a list
// (Request → Quote → Order) is untouched: a wave submits like any list.
// The pure cadence rules live in programme-cadence.ts (re-exported here).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deriveStage } from "@/lib/campaign-stage";
import { clampCadence, currentPeriodStart, shiftScheduleStart } from "@/lib/programme-cadence";
import type { BookingUnit } from "@/lib/campaign-schedule";

export * from "@/lib/programme-cadence";

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
 * The scheduleStart a copied line gets. A scheduled source line keeps its date
 * shifted onto the wave's slot. An UNSCHEDULED line falls back to the wave's
 * anchor — the current period at creation time shifted by the wave's offset —
 * exactly what planWaveDates previews on the /plan form ("Wave k: from …").
 * Without the fallback, waves born from an unscheduled plan had no dates at
 * all ("Date not set"), so findDueWaves' date-near nudge could never fire.
 * scheduleUnits deliberately stays null: the publisher's minimum run applies
 * downstream, same as any other unscheduled-length line.
 */
function copiedScheduleStart(
  item: { scheduleStart: Date | null; product: { bookingUnit: BookingUnit } | null },
  opts: { shiftWeeks: number; resetSchedule?: boolean; anchorNow?: Date },
): Date | null {
  if (opts.resetSchedule) return null;
  const unit = item.product?.bookingUnit ?? "MONTH";
  if (item.scheduleStart) {
    return opts.shiftWeeks > 0 ? shiftScheduleStart(item.scheduleStart, opts.shiftWeeks, unit) : item.scheduleStart;
  }
  if (!opts.anchorNow) return null;
  const first = currentPeriodStart(unit, opts.anchorNow);
  return opts.shiftWeeks > 0 ? shiftScheduleStart(first, opts.shiftWeeks, unit) : first;
}

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
    // Drop line schedules instead of shifting them — for a copy of a
    // finished campaign whose dates are all in the past.
    resetSchedule?: boolean;
    // When set, unscheduled source lines get the wave anchor implied by this
    // "now" instead of staying dateless (see copiedScheduleStart).
    anchorNow?: Date;
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
          scheduleStart: copiedScheduleStart(i, opts),
          scheduleUnits: opts.resetSchedule ? null : i.scheduleUnits,
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
  // Opt-in auto-send: the sweep submits each due wave as a normal RFQ.
  autoSend?: boolean;
  // Injectable "today" so wave anchors are deterministic in tests; the wave
  // dates persisted here must match what planWaveDates previewed on /plan.
  now?: Date;
}): Promise<{ programmeId: string; waveListIds: string[] }> {
  const { waves, spacingWeeks } = clampCadence(input.waves, input.spacingWeeks);
  const now = input.now ?? new Date();
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
        autoSendEnabled: input.autoSend ?? false,
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
            anchorNow: now,
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
  organizationId: string;
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
  else state = stage === 6 ? "done" : "live";
  return { state, orderId: order?.id ?? null, requestId: req.id };
}

function earliestStart(items: Array<{ scheduleStart: Date | null }>): Date | null {
  let min: Date | null = null;
  for (const i of items) if (i.scheduleStart && (!min || i.scheduleStart < min)) min = i.scheduleStart;
  return min;
}

function toView(
  p: {
    id: string;
    organizationId: string;
    name: string;
    plannedWaves: number;
    spacingWeeks: number;
    rationaleKey: string | null;
  },
  waves: WaveRow[],
): ProgrammeView {
  return {
    id: p.id,
    organizationId: p.organizationId,
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
  organizationId: string;
  programmeName: string;
  waveNumber: number;
  plannedWaves: number;
  articleAngle: string | null;
  scheduleStart: Date | null;
  reason: "previous-live" | "previous-done" | "date-near";
};

const DUE_HORIZON_DAYS = 21;

/**
 * Pure due filter over one programme view: the first draft wave (never wave 1)
 * whose previous wave is live/finished, or whose own start is within the
 * three-week horizon. At most one wave per programme — the next one only —
 * so the buyer gets a single nudge, and the auto-send sweep sends a single
 * wave per programme per run.
 */
export function dueWaveFromView(
  view: ProgrammeView,
  now: Date,
  opts?: {
    // Auto-send only: "date-near" may not fire while the PREVIOUS wave is
    // still an unsent draft. Without this, a freshly created programme whose
    // persisted anchors start in the current period would auto-submit wave 2
    // (then 3, 4…) within the hour — before the buyer ever sent wave 1. The
    // human nudge keeps the looser rule: a reminder is harmless, a submit
    // is not.
    requirePreviousSubmitted?: boolean;
  },
): DueWave | null {
  const horizon = new Date(now.getTime() + DUE_HORIZON_DAYS * 86_400_000);
  for (let i = 1; i < view.waves.length; i++) {
    const w = view.waves[i];
    if (w.state !== "draft") continue;
    const prev = view.waves[i - 1];
    let reason: DueWave["reason"] | null = null;
    if (prev.state === "done") reason = "previous-done";
    else if (prev.state === "live") reason = "previous-live";
    else if (
      w.scheduleStart &&
      w.scheduleStart <= horizon &&
      !(opts?.requirePreviousSubmitted && prev.state === "draft")
    )
      reason = "date-near";
    // No reason yet — a later draft wave may still be date-near (e.g. wave 2
    // dateless, wave 3 scheduled), so keep scanning instead of bailing out.
    if (!reason) continue;
    return {
      listId: w.listId,
      programmeId: view.id,
      organizationId: view.organizationId,
      programmeName: view.name,
      waveNumber: w.waveNumber,
      plannedWaves: view.plannedWaves,
      articleAngle: w.articleAngle,
      scheduleStart: w.scheduleStart,
      reason,
    };
  }
  return null;
}

async function findDueWavesWhere(
  where: Prisma.CampaignProgrammeWhereInput,
  now: Date,
  opts?: { requirePreviousSubmitted?: boolean },
): Promise<DueWave[]> {
  const programmes = await prisma.campaignProgramme.findMany({
    where: { ...where, archivedAt: null },
    include: { waves: { where: { archivedAt: null }, include: WAVE_STATE_INCLUDE } },
    orderBy: { createdAt: "desc" },
  });
  return programmes
    .map((p) => dueWaveFromView(toView(p, p.waves), now, opts))
    .filter((d): d is DueWave => d !== null);
}

/**
 * Waves the buyer should act on now: still a draft, and either the previous
 * wave is live/finished or this wave's start is within three weeks. Wave 1 is
 * never "due" (it's just an unsent plan — /requests already shows those).
 */
export async function findDueWaves(orgIds: string[], now: Date): Promise<DueWave[]> {
  if (orgIds.length === 0) return [];
  return findDueWavesWhere({ organizationId: { in: orgIds } }, now);
}

/** Due waves across ALL orgs, restricted to programmes that opted in to
 *  auto-send — the sweep's work list (see programme-autosend.ts). */
export async function findDueAutoSendWaves(now: Date): Promise<DueWave[]> {
  return findDueWavesWhere({ autoSendEnabled: true }, now, { requirePreviousSubmitted: true });
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

/**
 * Prefix a submit brief with the wave's article angle ("Article angle (wave
 * 2 of 3): …") when the list is a wave. Plain lists pass through unchanged.
 */
export async function withWaveAngle(
  brief: string,
  list: { programmeId: string | null; waveNumber: number | null; articleAngle: string | null },
): Promise<string> {
  if (!list.programmeId || !list.waveNumber) return brief;
  const programme = await prisma.campaignProgramme.findUnique({
    where: { id: list.programmeId },
    select: { plannedWaves: true },
  });
  const of = programme?.plannedWaves ?? list.waveNumber;
  const angle = list.articleAngle?.trim() || "(not set — fresh angle for this wave)";
  const line = `Article angle (wave ${list.waveNumber} of ${of}): ${angle}`;
  return brief ? `${line}\n${brief}` : line;
}

/**
 * Undo "Run this as a programme": every wave becomes an ordinary plan again —
 * the " · Wave N" name suffix goes, programme fields are nulled. Waves after
 * the first that were never submitted (no Request row) are pure copies the
 * buyer never touched downstream, so they're archived rather than left to
 * litter /lists as near-identical plans; wave 1 and anything already sent
 * always survives un-archived (submitted work is real, archived copies of it
 * would orphan the buyer's paper trail). The programme row itself is archived,
 * not deleted — audit references and any stale FK stay resolvable.
 *
 * One transaction: a half-dissolved programme (some waves plain, some still
 * enrolled) would confuse every surface that groups by programmeId.
 */
export async function dissolveProgramme(
  programmeId: string,
): Promise<{ kept: number; archived: number }> {
  return prisma.$transaction(async (tx) => {
    const waves = await tx.savedList.findMany({
      where: { programmeId },
      select: {
        id: true,
        name: true,
        waveNumber: true,
        archivedAt: true,
        _count: { select: { requests: true } },
      },
    });
    const now = new Date();
    let kept = 0;
    let archived = 0;
    for (const w of waves) {
      const isUnsentCopy = (w.waveNumber ?? 0) > 1 && w._count.requests === 0;
      // Already-archived waves keep their original archivedAt; everything
      // else either stays live (kept) or is archived as part of the dissolve.
      const archiveNow = isUnsentCopy && !w.archivedAt;
      await tx.savedList.update({
        where: { id: w.id },
        data: {
          name: w.name.replace(/\s*·\s*Wave \d+$/i, ""),
          programmeId: null,
          waveNumber: null,
          articleAngle: null,
          ...(archiveNow ? { archivedAt: now } : {}),
        },
      });
      if (archiveNow || w.archivedAt) archived++;
      else kept++;
    }
    await tx.campaignProgramme.update({
      where: { id: programmeId },
      data: { archivedAt: now },
    });
    return { kept, archived };
  });
}
