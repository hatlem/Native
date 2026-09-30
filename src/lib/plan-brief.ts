// The plan brief: what the buyer tells the desk about the campaign on /plan
// (what it sells, preferred timing, budget, audience segments, geography,
// context). It belongs to the plan: saved on the SavedList as the buyer types
// (savePlanBrief in list-actions.ts) and again on submit, so it survives
// navigation, is never shared between two plans, and a programme's later
// waves inherit it (programme.ts copies the columns).

import { prisma } from "@/lib/prisma";
import { isAudienceSegment } from "@/lib/targeting/segments";

// ---------- pure: timing ----------

export const FLEXIBLE_TIMING = "flexible";

export type TimingOption =
  | { value: string; kind: "quarter"; quarter: number; year: number }
  | { value: typeof FLEXIBLE_TIMING; kind: "flexible" };

// A quarter that ends within this many days is too late to plan a campaign
// into, so the offer starts at the next one.
const QUARTER_CUTOFF_DAYS = 30;

function quarterOf(d: Date): { quarter: number; year: number } {
  return { quarter: Math.floor(d.getUTCMonth() / 3) + 1, year: d.getUTCFullYear() };
}

function quarterValue(q: { quarter: number; year: number }): string {
  return `${q.year}-Q${q.quarter}`;
}

/** Parse a stored timing value ("2026-Q4" | "flexible"); anything else is null. */
export function parseTiming(value: string | null | undefined): TimingOption | null {
  if (value === FLEXIBLE_TIMING) return { value, kind: "flexible" };
  const m = /^(\d{4})-Q([1-4])$/.exec(value ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  return { value: quarterValue({ quarter, year }), kind: "quarter", quarter, year };
}

/**
 * The timing choices /plan offers: the next two quarters a campaign can still
 * run in, then "flexible". Computed from `now` (never hard-coded years), so
 * the options roll forward on their own.
 */
export function timingOptions(now: Date): TimingOption[] {
  const start = new Date(now.getTime() + QUARTER_CUTOFF_DAYS * 86_400_000);
  const first = quarterOf(start);
  const second =
    first.quarter === 4 ? { quarter: 1, year: first.year + 1 } : { quarter: first.quarter + 1, year: first.year };
  return [
    { value: quarterValue(first), kind: "quarter", ...first },
    { value: quarterValue(second), kind: "quarter", ...second },
    { value: FLEXIBLE_TIMING, kind: "flexible" },
  ];
}

// ---------- pure: normalise a posted brief ----------

export type RawListBrief = {
  briefText?: string | null;
  briefTiming?: string | null;
  budget?: string | null;
  budgetCurrency?: string | null;
  targetAudience?: readonly string[] | string | null;
  targetGeo?: string | null;
  targetContext?: string | null;
};

export type ListBriefData = {
  briefText: string | null;
  briefTiming: string | null;
  budget: number | null;
  currency: string | null;
  targetAudience: string | null;
  targetGeo: string | null;
  targetContext: string | null;
};

const BRIEF_TEXT_MAX = 4000;
const SHORT_FIELD_MAX = 200;
// The budget column is Decimal(12, 2).
const BUDGET_MAX = 9_999_999_999;

function text(v: string | null | undefined, max: number): string | null {
  const s = (v ?? "").trim().slice(0, max);
  return s.length ? s : null;
}

/** Untrusted form input → the SavedList columns. Unknown segments, junk
 *  budgets and unknown timing values are dropped rather than stored. */
export function normalizeListBrief(input: RawListBrief): ListBriefData {
  const segments = (
    typeof input.targetAudience === "string" ? input.targetAudience.split(",") : (input.targetAudience ?? [])
  )
    .map((s) => s.trim())
    .filter(isAudienceSegment);
  const budgetNum = Number((input.budget ?? "").trim());
  const budget =
    (input.budget ?? "").trim() !== "" && Number.isFinite(budgetNum) && budgetNum > 0
      ? Math.min(Math.round(budgetNum * 100) / 100, BUDGET_MAX)
      : null;
  const currency = /^[A-Z]{3}$/.test(input.budgetCurrency ?? "") ? input.budgetCurrency! : null;
  return {
    briefText: text(input.briefText, BRIEF_TEXT_MAX),
    briefTiming: parseTiming(input.briefTiming)?.value ?? null,
    budget,
    currency: budget !== null ? currency : null,
    targetAudience: segments.length ? [...new Set(segments)].join(",") : null,
    targetGeo: text(input.targetGeo, SHORT_FIELD_MAX),
    targetContext: text(input.targetContext, SHORT_FIELD_MAX),
  };
}

// ---------- pure: stored brief → form defaults ----------

export type PlanBriefValues = {
  briefText: string;
  briefTiming: string | null;
  budget: string;
  targetAudience: string[];
  targetGeo: string;
  targetContext: string;
};

export function planBriefValues(list: {
  briefText: string | null;
  briefTiming: string | null;
  budget: unknown;
  targetAudience: string | null;
  targetGeo: string | null;
  targetContext: string | null;
}): PlanBriefValues {
  return {
    briefText: list.briefText ?? "",
    briefTiming: parseTiming(list.briefTiming)?.value ?? null,
    budget: list.budget != null && Number(list.budget) > 0 ? String(Number(list.budget)) : "",
    targetAudience: (list.targetAudience ?? "").split(",").filter(isAudienceSegment),
    targetGeo: list.targetGeo ?? "",
    targetContext: list.targetContext ?? "",
  };
}

// ---------- DB ----------

/** Persist the brief on the plan. The caller has resolved and access-checked
 *  the list (lib/plan-target.ts). updateMany: an archived-meanwhile or deleted
 *  list simply no-ops. */
export async function saveListBrief(listId: string, input: RawListBrief): Promise<void> {
  await prisma.savedList.updateMany({ where: { id: listId }, data: normalizeListBrief(input) });
}
