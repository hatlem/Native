import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/tokens";

// Create TrackedLink rows for the chosen destination URLs on an order
// line, skipping URLs already tracked for that line (idempotent). Returns
// the full url→token map for the line so the caller can rewrite the body.
export async function ensureTrackedLinks(
  orderLineId: string,
  links: { url: string; label?: string | null }[],
): Promise<Record<string, string>> {
  const existing = await prisma.trackedLink.findMany({
    where: { orderLineId },
    select: { token: true, targetUrl: true },
  });
  const map: Record<string, string> = {};
  for (const e of existing) map[e.targetUrl] = e.token;

  for (const l of links) {
    if (map[l.url]) continue;
    const token = generateToken();
    await prisma.trackedLink.create({
      data: { orderLineId, token, targetUrl: l.url, label: l.label ?? null },
    });
    map[l.url] = token;
  }
  return map;
}

// Aggregate click totals per order line for a set of lines.
export async function clicksByOrderLine(
  orderLineIds: string[],
): Promise<Record<string, number>> {
  if (orderLineIds.length === 0) return {};
  const rows = await prisma.trackedLink.groupBy({
    by: ["orderLineId"],
    where: { orderLineId: { in: orderLineIds } },
    _sum: { clickCount: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.orderLineId] = r._sum.clickCount ?? 0;
  return out;
}
