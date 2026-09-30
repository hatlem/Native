// "Download plan" on /plan: the plan as PDF or Word, rendered on demand from
// the saved list with the page's own pricing helpers, so the document says
// what the page says (lib/pdf/plan-document.ts). For the org's team to pass
// around internally; access is read access to the org, view-only seats
// included (lib/pdf/plan-download.ts authorizePlanDownload).

import { NextResponse } from "next/server";
import { safeLocale } from "@/i18n/routing";
import { loadScope } from "@/lib/scope";
import {
  authorizePlanDownload,
  parsePlanDownloadFormat,
  planDocumentLink,
  planDownloadResponse,
} from "@/lib/pdf/plan-download";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ listId: string; format: string }> }) {
  const { listId, format: rawFormat } = await params;
  const format = parsePlanDownloadFormat(rawFormat);
  if (!format) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const access = await authorizePlanDownload(await loadScope(), listId);
  if (!access.ok) return access.response;

  const locale = safeLocale(new URL(req.url).searchParams.get("locale"));
  const { list } = access;
  return planDownloadResponse({
    list,
    brief: list,
    audience: "team",
    link: planDocumentLink(list.id, list.shareToken, locale),
    format,
    locale,
    actor: access.userId,
  });
}
