import { cookies } from "next/headers";

export const PLAN_COOKIE = "benative_plan";

export type BasketItem = { productId: string; quantity: number };

export async function readBasket(): Promise<BasketItem[]> {
  const store = await cookies();
  const raw = store.get(PLAN_COOKIE)?.value;
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

export function serializeBasket(items: BasketItem[]): string {
  return JSON.stringify(items);
}
