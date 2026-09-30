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
import { buyerVisibleQuoteWhere } from "@/lib/commerce/quote-validity";
import { lineOrder } from "@/lib/commerce/line-order";
import { activeMembershipWhere } from "@/lib/membership";
import { BUYER_REQUEST_SELECT, BUYER_ORDER_SELECT } from "@/lib/export/buyer-export";

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

  const [orgs, memberships, plans, savedLists, requests, orders, invoices] = await Promise.all([
    prisma.organization.findMany({ where: { id: { in: orgIds } } }),
    // The org's people are its ACTIVE memberships (the access model since
    // memberships replaced the home-org column), not User.organizationId:
    // that listed 1 of 3 members of a team whose others joined by invite.
    // Only what the org's own team table shows: who, and their role there.
    prisma.membership.findMany({
      where: {
        AND: [{ organizationId: { in: orgIds } }, activeMembershipWhere()],
        user: { deactivatedAt: null },
      },
      orderBy: [{ organizationId: "asc" }, { createdAt: "asc" }],
      select: {
        organizationId: true,
        role: true,
        canCommit: true,
        user: { select: { id: true, email: true, name: true } },
      },
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
    // A buyer's export holds what was sent to them; the desk's unsent DRAFT
    // pricing and its internal fields only appear in a desk-run export.
    isDesk
      ? prisma.request.findMany({
          where: { organizationId: { in: orgIds } },
          include: { quotes: { include: { lines: { orderBy: lineOrder() } } } },
        })
      : prisma.request.findMany({ where: { organizationId: { in: orgIds } }, select: BUYER_REQUEST_SELECT }),
    isDesk
      ? prisma.order.findMany({
          where: { organizationId: { in: orgIds } },
          // `brief` alongside `article`: the ContentBrief (message/audience/
          // do/don't) is org-supplied personal-ish data the export must keep,
          // and it is no longer reachable through the asset tree now that
          // ContentAsset hangs off Article instead of ContentBrief.
          include: {
            lines: {
              orderBy: lineOrder(),
              include: {
                brief: true,
                articlePlacement: { include: { article: { include: { versions: true } } } },
                booking: true,
              },
            },
          },
        })
      : prisma.order.findMany({ where: { organizationId: { in: orgIds } }, select: BUYER_ORDER_SELECT }),
    prisma.invoice.findMany({
      where: { organizationId: { in: orgIds } },
      include: { lines: { orderBy: lineOrder() } },
    }),
  ]);

  await recordAudit(session.user.id, "data.export", `Organization:${orgIds.join(",")}`, {
    asked: askedOrg ?? null,
  });

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      orgs,
      // One row per member per org, flattened: who, and their role there.
      users: memberships.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        organizationId: m.organizationId,
        role: m.role,
        canCommit: m.canCommit,
      })),
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
