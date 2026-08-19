// GDPR / PLAN §14: a signed-in user can export everything their
// organisation has on the platform — orgs, users, plans, requests,
// quotes, orders, invoices, briefs, assets. Desk/superadmin can
// pass ?org=<id> to export any org (audited).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { recordAudit } from "@/lib/audit";
import { exportLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  // Heavy multi-table read — cap per user so a bad actor (or buggy
  // client) can't burn DB time or egress hammering the endpoint. Desk
  // calls hit the same limit; the audit log already records who ran what.
  const limit = await exportLimiter.check(`export:${session.user.id}`);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate limit", retryAfterMs: limit.retryAfterMs },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      },
    );
  }

  const role = session.user.role;
  const isDesk = role === "DESK" || role === "SUPERADMIN";
  const askedOrg = req.nextUrl.searchParams.get("org");

  let orgIds: string[];
  if (askedOrg) {
    if (!isDesk) {
      const ws = await getWorkspace(session.user.id);
      if (!ws?.scopeOrgIds.includes(askedOrg)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
    orgIds = [askedOrg];
  } else {
    const ws = await getWorkspace(session.user.id);
    if (!ws) {
      return NextResponse.json({ error: "no organization" }, { status: 400 });
    }
    orgIds = ws.scopeOrgIds;
  }

  const [orgs, users, plans, savedLists, requests, orders, invoices] = await Promise.all([
    prisma.organization.findMany({ where: { id: { in: orgIds } } }),
    prisma.user.findMany({
      where: { organizationId: { in: orgIds } },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
    prisma.plan.findMany({
      where: { organizationId: { in: orgIds } },
      include: { items: true },
    }),
    prisma.savedList.findMany({
      where: { organizationId: { in: orgIds } },
      select: {
        id: true,
        name: true,
        note: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            productId: true,
            titleId: true,
            quantity: true,
            withContent: true,
            notes: true,
          },
        },
      },
    }),
    prisma.request.findMany({
      where: { organizationId: { in: orgIds } },
      include: { quotes: { include: { lines: true } } },
    }),
    prisma.order.findMany({
      where: { organizationId: { in: orgIds } },
      include: { lines: { include: { article: { include: { versions: true } }, booking: true } } },
    }),
    prisma.invoice.findMany({
      where: { organizationId: { in: orgIds } },
      include: { lines: true },
    }),
  ]);

  await recordAudit(session.user.id, "data.export", `Organization:${orgIds.join(",")}`, {
    asked: askedOrg ?? null,
  });

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      orgs,
      users,
      plans,
      savedLists,
      requests,
      orders,
      invoices,
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename="nativespin-export-${Date.now()}.json"`,
      },
    },
  );
}
