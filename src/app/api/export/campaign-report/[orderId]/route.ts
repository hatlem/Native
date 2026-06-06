// Campaign-report CSV export — buyer-facing (gated by org scope) and
// desk/superadmin. No cost or margin columns; metrics only.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { csv } from "@/lib/csv";
import { recordAudit } from "@/lib/audit";
import { clicksByOrderLine } from "@/lib/metrics/store";
import { ctrPct } from "@/lib/reporting";
import { getWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lines: {
        include: {
          booking: {
            include: {
              metrics: true,
              publisher: { select: { name: true } },
              title: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const role = session.user.role;
  if (role !== "DESK" && role !== "SUPERADMIN") {
    const ws = await getWorkspace(session.user.id);
    if (!ws?.scopeOrgIds.includes(order.organizationId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const clicks = await clicksByOrderLine(order.lines.map((l) => l.id));

  const rows = order.lines.flatMap((l) => {
    const b = l.booking;
    if (!b) return [];
    const firstParty =
      b.metrics?.clicksFirstPartyAtClose ?? clicks[l.id] ?? 0;
    const impressions =
      b.metrics?.impressionsAtClose ?? b.metrics?.impressions ?? null;
    return [
      {
        publisher: b.publisher?.name ?? "",
        title: b.title?.name ?? "",
        live_start: b.liveStartDate?.toISOString() ?? "",
        live_end: b.liveEndDate?.toISOString() ?? "",
        impressions: impressions ?? "",
        first_party_clicks: firstParty,
        page_views: b.metrics?.pageViews ?? "",
        avg_time_sec: b.metrics?.avgTimeSec ?? "",
        scroll_depth_pct: b.metrics?.scrollDepthPct ?? "",
        ctr_pct: ctrPct(firstParty, impressions) ?? "",
      },
    ];
  });

  await recordAudit(
    session.user.id,
    "export.campaign_report",
    `Order:${orderId}`,
    { count: rows.length },
  );

  const CSV_HEADERS = [
    "publisher",
    "title",
    "live_start",
    "live_end",
    "impressions",
    "first_party_clicks",
    "page_views",
    "avg_time_sec",
    "scroll_depth_pct",
    "ctr_pct",
  ];

  return new NextResponse(csv(rows, CSV_HEADERS), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campaign-${orderId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
