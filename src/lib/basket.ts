import { cookies } from "next/headers";

export const PLAN_COOKIE = "nativespin_plan";
// Brief draft persisted alongside the basket so the buyer doesn't
// lose their budget/audience/goal/brief text when the buy-gate
// detours them to /onboarding. Cleared on successful submit.
export const PLAN_BRIEF_COOKIE = "nativespin_brief";

export const MAX_QTY = 20;

// Clamp an untrusted quantity into [1, MAX_QTY]; non-finite → 1.
export function clampQuantity(n: number): number {
  const t = Math.trunc(Number(n));
  if (!Number.isFinite(t) || t < 1) return 1;
  return Math.min(t, MAX_QTY);
}

export type BasketItem = {
  productId: string;
  quantity: number;
  // When true the buyer wants NativeSpin to produce the native content
  // for this placement — drives a CONTENT_FEE quote line. Optional in the
  // cookie payload; absent/false means bring-your-own-content.
  withContent?: boolean;
};

export type PlanBrief = {
  budget: string;
  audience: string;
  goal: string;
  brief: string;
  targetGeo: string;
  targetAudience: string;
  targetContext: string;
};

const EMPTY_BRIEF: PlanBrief = {
  budget: "",
  audience: "",
  goal: "",
  brief: "",
  targetGeo: "",
  targetAudience: "",
  targetContext: "",
};

// Pure: tolerate any untrusted cookie payload and normalise. Caps each
// field length so a hostile cookie can't blow up the page render.
export function parsePlanBrief(raw: string | undefined | null): PlanBrief {
  if (!raw) return EMPTY_BRIEF;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_BRIEF;
    const o = parsed as Record<string, unknown>;
    const str = (v: unknown, max: number) =>
      typeof v === "string" ? v.slice(0, max) : "";
    return {
      budget: str(o.budget, 32),
      audience: str(o.audience, 200),
      goal: str(o.goal, 200),
      brief: str(o.brief, 4000),
      targetGeo: str(o.targetGeo, 200),
      targetAudience: str(o.targetAudience, 400),
      targetContext: str(o.targetContext, 200),
    };
  } catch {
    return EMPTY_BRIEF;
  }
}

export async function readPlanBrief(): Promise<PlanBrief> {
  const store = await cookies();
  return parsePlanBrief(store.get(PLAN_BRIEF_COOKIE)?.value);
}

export function serializePlanBrief(brief: PlanBrief): string {
  return JSON.stringify(brief);
}

export function planBriefHasContent(brief: PlanBrief): boolean {
  return !!(brief.budget || brief.audience || brief.goal || brief.brief);
}

// Pure: tolerate any untrusted cookie payload and normalise to a safe basket.
export function parseBasket(raw: string | undefined | null): BasketItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is { productId: string; quantity?: unknown; withContent?: unknown } =>
          !!x && typeof (x as { productId?: unknown }).productId === "string",
      )
      .map((x) => ({
        productId: x.productId,
        quantity: Math.max(1, Math.trunc(Number(x.quantity)) || 1),
        withContent: x.withContent === true,
      }));
  } catch {
    return [];
  }
}

export async function readBasket(): Promise<BasketItem[]> {
  const store = await cookies();
  return parseBasket(store.get(PLAN_COOKIE)?.value);
}

export function serializeBasket(items: BasketItem[]): string {
  return JSON.stringify(items);
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

export async function writeBasket(items: BasketItem[]): Promise<void> {
  const store = await cookies();
  store.set(PLAN_COOKIE, serializeBasket(items), COOKIE_OPTS);
}

export async function writePlanBrief(brief: PlanBrief): Promise<void> {
  const store = await cookies();
  store.set(PLAN_BRIEF_COOKIE, serializePlanBrief(brief), COOKIE_OPTS);
}
