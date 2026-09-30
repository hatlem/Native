import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { safeLocale } from "@/i18n/routing";
import { recordAudit } from "@/lib/audit";
import { loadExtraWorkRates, loadPricingDefaults } from "@/lib/content-fee";
import { SHARED_LIST_SELECT, shareUrl, type SharedList } from "@/lib/list-share";
import { planPath } from "@/lib/plan-path";
import { prisma } from "@/lib/prisma";
import { canActOnOrg, type Scope } from "@/lib/scope";
import { displayTimeZone } from "@/lib/time-zone";
import { appUrl } from "@/lib/url";
import { buildPlanDocument, type PlanDocumentAudience, type PlanDocumentBrief } from "./plan-document";
import { PlanDocumentPdf } from "./PlanDocument";
import { renderPlanDocx } from "./plan-docx";
import { attachmentDisposition } from "./quote-download";

// The plan download ("Last ned plan"), shared by its two routes:
//
//   /api/export/plan/<listId>/<format>        the org's team, from /plan
//   /api/export/shared-plan/<token>/<format>  whoever holds the share link
//
// Each route decides who may have the plan; everything after that (the model,
// the two renderers, the audit row, the response) is this one path, so the
// two downloads can only differ where the pages differ: the team's copy
// carries the brief, the client's is exactly the share page.

export const PLAN_DOWNLOAD_FORMATS = ["pdf", "docx"] as const;
export type PlanDownloadFormat = (typeof PLAN_DOWNLOAD_FORMATS)[number];

export function parsePlanDownloadFormat(value: string): PlanDownloadFormat | null {
  return (PLAN_DOWNLOAD_FORMATS as readonly string[]).includes(value) ? (value as PlanDownloadFormat) : null;
}

const CONTENT_TYPE: Record<PlanDownloadFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

// The team's copy: the share page's fields plus the brief, and the share token
// so the document can point at the link that opens without a login.
const TEAM_PLAN_SELECT = {
  ...SHARED_LIST_SELECT,
  shareToken: true,
  briefText: true,
  briefTiming: true,
  budget: true,
  currency: true,
  targetAudience: true,
  targetGeo: true,
  targetContext: true,
  targetVerticals: true,
} as const;

type TeamPlan = SharedList & PlanDocumentBrief & { shareToken: string | null };

export type AuthorizedPlanDownload =
  | { ok: true; userId: string; list: TeamPlan }
  | { ok: false; response: NextResponse };

// Who may download a plan from /plan: anyone who may open it there, which is
// read access to its org (canActOnOrg). A RESTRICTED (view-only) seat
// included: the document is a read-out, like the page it sees. Another org's
// plan, a missing one and an archived one are the same 404, so the route never
// confirms that someone else's plan exists.
export async function authorizePlanDownload(scope: Scope, listId: string): Promise<AuthorizedPlanDownload> {
  if (!scope.userId) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const list = await prisma.savedList.findUnique({ where: { id: listId }, select: TEAM_PLAN_SELECT });
  if (!list || list.archivedAt || !canActOnOrg(scope, list.organizationId)) return { ok: false, response: notFound() };
  return { ok: true, userId: scope.userId, list };
}

// The live plan the document points at: the share link when there is one (it
// opens without a login, so a colleague without an account can follow it),
// otherwise the plan's own address.
export function planDocumentLink(listId: string, shareToken: string | null, rawLocale: string) {
  const locale = safeLocale(rawLocale);
  return shareToken
    ? { kind: "share" as const, url: shareUrl(appUrl(), locale, shareToken) }
    : { kind: "plan" as const, url: `${appUrl().replace(/\/+$/, "")}${planPath(locale, listId)}` };
}

export async function planDownloadResponse(args: {
  list: SharedList;
  brief: PlanDocumentBrief | null;
  audience: PlanDocumentAudience;
  link: { kind: "share" | "plan"; url: string };
  format: PlanDownloadFormat;
  locale: string;
  actor: string | null;
}): Promise<NextResponse> {
  const locale = safeLocale(args.locale);
  const [pricing, extraWorkRates] = await Promise.all([loadPricingDefaults(), loadExtraWorkRates()]);
  const doc = buildPlanDocument({
    list: args.list,
    brief: args.brief,
    pricing,
    extraWorkRates,
    locale,
    audience: args.audience,
    link: args.link,
    generatedAt: new Date(),
    timeZone: displayTimeZone({ marketCode: args.list.organization.marketCode, locale }),
  });
  const body =
    args.format === "pdf"
      ? new Uint8Array(await renderToBuffer(PlanDocumentPdf({ doc })))
      : new Uint8Array(await renderPlanDocx(doc));

  await recordAudit(args.actor, `plan.${args.format}.download`, `SavedList:${args.list.id}`, {
    locale,
    audience: args.audience,
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": CONTENT_TYPE[args.format],
      "Content-Disposition": attachmentDisposition(`${doc.filename}.${args.format}`),
      "Cache-Control": "private, no-store",
      // The client's copy is addressed by a credential-bearing URL: keep it out
      // of indexes and referrers, like the share page itself.
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
