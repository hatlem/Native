import { cookies } from "next/headers";

// DEPRECATED: the items-array basket cookie (`nativespin_plan`) is superseded by
// the SavedList model + the `nativespin_active_list` pointer cookie. It is retained
// only for (a) one-time migration of in-flight baskets into a SavedList and (b) the
// order-template rehydrate path (until Task 8). No new code should WRITE this cookie.
export const PLAN_COOKIE = "nativespin_plan";
// DEPRECATED: the brief draft cookie. The brief now lives on the plan itself
// (SavedList.briefText & co, lib/plan-brief.ts); nothing writes it any more.
// Kept only so sign-out still deletes a copy left in a browser.
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

