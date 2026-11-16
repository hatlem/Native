// Entity search for the desk command palette: orders, requests (by
// organisation) and titles. Read-only; the route that calls this is
// role-checked (DESK / SUPERADMIN only).

import { prisma } from "@/lib/prisma";

export type DeskSearchHit = {
  kind: "order" | "request" | "title";
  id: string;
  label: string;
  sub: string;
  href: string;
};

export const DESK_SEARCH_MIN = 2;
export const DESK_SEARCH_MAX = 60;
const PER_KIND = 5;

/** Normalise the query; null when it is too short to search on. */
export function normalizeDeskQuery(raw: string | null | undefined): string | null {
  const q = (raw ?? "").trim().replace(/^#/, "").slice(0, DESK_SEARCH_MAX);
  return q.length >= DESK_SEARCH_MIN ? q : null;
}

/** The short order number shown in the UI ("#BTJ519SP") is the id's last 8 characters. */
export function orderNumber(id: string): string {
  return `#${id.slice(-8).toUpperCase()}`;
}

export async function deskSearch(q: string, canSeeTitles: boolean): Promise<DeskSearchHit[]> {
  const contains = { contains: q, mode: "insensitive" as const };
  const idSuffix = { endsWith: q.toLowerCase() };
  const [orders, requests, titles] = await Promise.all([
    prisma.order.findMany({
      where: { OR: [{ id: idSuffix }, { id: q }, { organization: { name: contains } }] },
      orderBy: { createdAt: "desc" },
      take: PER_KIND,
      select: { id: true, status: true, organization: { select: { name: true } } },
    }),
    prisma.request.findMany({
      where: {
        status: { not: "DRAFT" },
        OR: [{ id: q }, { organization: { name: contains } }, { plan: { name: contains } }],
      },
      orderBy: { updatedAt: "desc" },
      take: PER_KIND,
      select: {
        id: true,
        status: true,
        organization: { select: { name: true } },
        plan: { select: { name: true } },
      },
    }),
    canSeeTitles
      ? prisma.title.findMany({
          where: { name: contains },
          orderBy: { name: "asc" },
          take: PER_KIND,
          select: { id: true, name: true, publisher: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  return [
    ...orders.map((o) => ({
      kind: "order" as const,
      id: o.id,
      label: `${orderNumber(o.id)} · ${o.organization.name}`,
      sub: o.status,
      href: `/desk/orders/${o.id}`,
    })),
    ...requests.map((r) => ({
      kind: "request" as const,
      id: r.id,
      label: `${r.organization.name} · ${r.plan.name}`,
      sub: r.status,
      href: `/desk/${r.id}`,
    })),
    ...titles.map((t) => ({
      kind: "title" as const,
      id: t.id,
      label: t.name,
      sub: t.publisher?.name ?? "",
      href: `/desk/titles/${t.id}`,
    })),
  ];
}
