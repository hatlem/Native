// Hygiene sweep: flip ACTIVE memberships past their expiresAt to EXPIRED
// and email the affected user a heads-up.
//
// IMPORTANT — this is NOT the security boundary. The lazy check at request
// time (membership.ts / workspace.ts) is the real gate; an expired
// membership is already blocked regardless of status in DB. This cron only
// keeps the status column accurate and sends a notification so users know
// they've lost access.
//
// Idempotent: re-running after a sweep finds 0 due rows (they're already
// EXPIRED) and returns { expired: 0 } with no side effects.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { emailAdapter } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  // Fail closed: if no secret is configured we cannot authenticate callers.
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await prisma.membership.findMany({
    where: { status: "ACTIVE", expiresAt: { not: null, lte: now } },
    select: {
      id: true,
      organization: { select: { name: true } },
      user: { select: { email: true, name: true } },
    },
  });

  if (due.length === 0) {
    return NextResponse.json({ expired: 0 });
  }

  await prisma.membership.updateMany({
    where: { id: { in: due.map((d) => d.id) } },
    data: { status: "EXPIRED" },
  });

  for (const d of due) {
    if (!d.user?.email) continue;
    try {
      await emailAdapter({
        to: d.user.email,
        subject: `Your delegated access to ${d.organization?.name ?? "an organization"} has ended`,
        text: `Hi ${d.user.name ?? ""},\n\nYour time-limited access to ${d.organization?.name ?? "the organization"} on NativeSpin reached its end date and has been removed. Ask an admin if you need it extended.\n\nNativeSpin`,
      });
    } catch (err) {
      console.error("expire_memberships.email_failed", { id: d.id, err });
    }
  }

  return NextResponse.json({ expired: due.length });
}
