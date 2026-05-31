// Pure validator for the POST /api/v1/orders body. No DB, no Prisma — kept
// pure so it's unit-testable and the route handler stays thin. Dedupes
// repeated productIds by summing quantity (mirrors basket behavior) so a
// client that lists the same product twice gets one line.

export type ParsedOrder =
  | {
      ok: true;
      items: { productId: string; quantity: number }[];
      reference: string | null;
    }
  | { ok: false; error: "bad_body" | "no_items" | "bad_item" | "bad_quantity" };

export function parseOrderRequest(body: unknown): ParsedOrder {
  if (!body || typeof body !== "object") return { ok: false, error: "bad_body" };
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return { ok: false, error: "bad_body" };
  if (items.length === 0) return { ok: false, error: "no_items" };

  const merged = new Map<string, number>();
  for (const it of items) {
    if (!it || typeof it !== "object") return { ok: false, error: "bad_item" };
    const pid = (it as { productId?: unknown }).productId;
    const qty = (it as { quantity?: unknown }).quantity;
    if (typeof pid !== "string" || pid.length === 0) {
      return { ok: false, error: "bad_item" };
    }
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) {
      return { ok: false, error: "bad_quantity" };
    }
    merged.set(pid, (merged.get(pid) ?? 0) + qty);
  }

  const refRaw = (body as { reference?: unknown }).reference;
  const reference = typeof refRaw === "string" ? refRaw.slice(0, 200) : null;
  return {
    ok: true,
    items: [...merged].map(([productId, quantity]) => ({ productId, quantity })),
    reference,
  };
}
