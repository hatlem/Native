import { cookies } from "next/headers";

export const PLAN_COOKIE = "atnative_plan";

export type BasketItem = { productId: string; quantity: number };

// Pure: tolerate any untrusted cookie payload and normalise to a safe basket.
export function parseBasket(raw: string | undefined | null): BasketItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is { productId: string; quantity?: unknown } =>
          !!x && typeof (x as { productId?: unknown }).productId === "string",
      )
      .map((x) => ({
        productId: x.productId,
        quantity: Math.max(1, Math.trunc(Number(x.quantity)) || 1),
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
