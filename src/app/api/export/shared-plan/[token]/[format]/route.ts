// "Download this plan" on the public share page (/share/<token>): the same
// document as the team's download, minus what the share page doesn't show
// (the brief), addressed only by the share token. No sign-in, so it is rate
// limited per IP; a disabled, rotated or archived link is a 404, exactly like
// the page (lib/list-share.ts loadSharedList).

import { NextResponse } from "next/server";
import { safeLocale } from "@/i18n/routing";
import { requestIp } from "@/lib/client-ip";
import { loadSharedList, shareUrl } from "@/lib/list-share";
import { parsePlanDownloadFormat, planDownloadResponse } from "@/lib/pdf/plan-download";
import { shareDownloadLimiter } from "@/lib/rate-limit";
import { appUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string; format: string }> }) {
  const { token, format: rawFormat } = await params;
  const format = parsePlanDownloadFormat(rawFormat);
  if (!format) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Before the lookup, so the limit also caps token guessing.
  const rate = await shareDownloadLimiter.check(`share-download:${requestIp(req.headers)}`);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  const list = await loadSharedList(token);
  if (!list) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const locale = safeLocale(new URL(req.url).searchParams.get("locale"));
  return planDownloadResponse({
    list,
    brief: null,
    audience: "client",
    link: { kind: "share", url: shareUrl(appUrl(), locale, token) },
    format,
    locale,
    // No account behind a share link: the audit row is the system's.
    actor: null,
  });
}
