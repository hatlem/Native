// RFC 8058 one-click unsubscribe for outreach mail (rate-card campaign and
// price requests). Mailbox providers POST here — directly, or through the
// middleware rewrite of a POST to the opt-out page URL that the
// List-Unsubscribe header names (lib/outreach/one-click.ts) — and expect a
// plain 2xx. No session: the token in the link is the credential, exactly as
// on the opt-out pages.

import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/log";
import { appUrl } from "@/lib/url";
import { ONE_CLICK_KIND_HEADER, ONE_CLICK_TOKEN_HEADER, isOneClickKind } from "@/lib/outreach/one-click";
import { unsubscribePriceRequest } from "@/lib/pricing/requests";
import { unsubscribeAction as unsubscribeRateCard } from "@/app/[locale]/rate-card/[token]/actions";

export const dynamic = "force-dynamic";

// The target: from the query string on a direct call, or from the headers the
// middleware sets when it rewrites a POST to an opt-out page URL.
function target(req: NextRequest): { kind: string | null; token: string | null } {
  const kind = req.nextUrl.searchParams.get("kind") ?? req.headers.get(ONE_CLICK_KIND_HEADER);
  const fromQuery = req.nextUrl.searchParams.get("token");
  if (fromQuery) return { kind, token: fromQuery };
  const fromHeader = req.headers.get(ONE_CLICK_TOKEN_HEADER);
  try {
    return { kind, token: fromHeader ? decodeURIComponent(fromHeader) : null };
  } catch {
    return { kind, token: null };
  }
}

export async function POST(req: NextRequest) {
  const { kind, token } = target(req);
  if (!isOneClickKind(kind) || !token) return new NextResponse(null, { status: 400 });
  try {
    if (kind === "rate-card") await unsubscribeRateCard(token);
    else await unsubscribePriceRequest(token);
  } catch (err) {
    // The provider retries on a 5xx; an unknown token is a silent no-op above.
    log.error("outreach.one_click_unsubscribe_failed", { kind, err });
    return new NextResponse(null, { status: 500 });
  }
  // The same answer for a known and an unknown token.
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

// A person following the link lands on the opt-out page, which unsubscribes
// and says so in their language.
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const token = req.nextUrl.searchParams.get("token");
  if (!isOneClickKind(kind) || !token) return new NextResponse(null, { status: 400 });
  return NextResponse.redirect(`${appUrl()}/en/${kind}/${encodeURIComponent(token)}/unsubscribe`, 303);
}
