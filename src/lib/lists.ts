import { cookies } from "next/headers";

export const ACTIVE_LIST_COOKIE = "nativespin_active_list";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export type ItemShape = { productId: string | null; titleId: string | null };

/** A SavedListItem must reference exactly one of product or title. */
export function assertItemShape(item: ItemShape): void {
  const hasProduct = !!item.productId;
  const hasTitle = !!item.titleId;
  if (hasProduct === hasTitle) {
    throw new Error("SavedListItem must reference exactly one of productId / titleId");
  }
}

/** Any unresolved Title placeholder forces the desk RFQ path (cannot auto-price). */
export function listForcesRfq(items: ItemShape[]): boolean {
  return items.some((i) => !i.productId);
}

export async function readActiveListId(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_LIST_COOKIE)?.value ?? null;
}

export async function writeActiveListId(id: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_LIST_COOKIE, id, COOKIE_OPTS);
}

export async function clearActiveListId(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_LIST_COOKIE);
}
