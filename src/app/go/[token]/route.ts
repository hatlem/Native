import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

// First-party click counter. Looks up the tracked link, increments its
// counter, and 302-redirects to the advertiser destination. Unknown or
// malformed token → redirect to the marketplace home (never a 500, never
// reflect the token into an error page).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const fallback = appUrl();
  if (!token) return NextResponse.redirect(fallback);

  const link = await prisma.trackedLink.findUnique({
    where: { token },
    select: { id: true, targetUrl: true },
  });
  if (!link) return NextResponse.redirect(fallback);

  // Best-effort count — never block or fail the redirect on the write.
  prisma.trackedLink
    .update({
      where: { id: link.id },
      data: { clickCount: { increment: 1 } },
    })
    .catch((err) => console.error("trackedlink.increment_failed", err));

  return NextResponse.redirect(link.targetUrl);
}
