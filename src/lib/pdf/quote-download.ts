import type { QuoteStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnOrg, type Scope } from "@/lib/scope";

// Who may download a quote document (PDF or DOCX), shared by both export
// routes. The desk may fetch any quote, drafts included (it reviews the
// document before sending). A buyer may fetch their own organisation's
// quotes once sent, exactly the ones their request page shows
// (buyerVisibleQuoteWhere): a buyer who needs the offer for internal
// approval has something to attach. Anyone else, and a buyer asking for a
// draft, gets the same 404 as a missing quote, so the route never confirms
// that another organisation's quote exists. A quote a sent revision
// replaced is no longer an offer, so no new document is made from it for
// anyone (lib/pdf/quote-pdf-data QuoteSupersededError): "superseded" points
// the caller at the revision instead.
export type QuoteDownloadDecision = "desk" | "buyer" | "superseded" | "not_found";

export function quoteDownloadDecision(args: {
  isDesk: boolean;
  canActOnOwningOrg: boolean;
  status: QuoteStatus;
}): QuoteDownloadDecision {
  const allowed = args.isDesk || (args.canActOnOwningOrg && args.status !== "DRAFT");
  if (!allowed) return "not_found";
  if (args.status === "SUPERSEDED") return "superseded";
  return args.isDesk ? "desk" : "buyer";
}

// The fallback "Prepared by" on a buyer's copy when the sender can't be
// resolved: the desk's shared inbox, never the buyer's own name.
export const DESK_PREPARED_BY = { name: null, email: "desk@nativespin.com" } as const;

export type PreparedBy = { name: string | null; email: string };

// The desk member who sent (or last renewed) the quote, from the audit
// trail: the person a buyer's copy should name. A buyer downloading their
// quote must not see themselves as its author.
async function quoteSender(quoteId: string): Promise<PreparedBy> {
  const sent = await prisma.auditLog.findFirst({
    where: { entity: `Quote:${quoteId}`, action: { in: ["quote.send", "quote.renew"] } },
    orderBy: { createdAt: "desc" },
    select: { actor: true },
  });
  const user = sent
    ? await prisma.user.findUnique({
        where: { id: sent.actor },
        select: { name: true, email: true, role: true },
      })
    : null;
  return user && (user.role === "DESK" || user.role === "SUPERADMIN")
    ? { name: user.name, email: user.email }
    : DESK_PREPARED_BY;
}

export type AuthorizedQuoteDownload =
  | { ok: true; userId: string; audience: "desk" | "buyer"; preparedBy: PreparedBy }
  | { ok: false; response: NextResponse };

export async function authorizeQuoteDownload(
  scope: Scope,
  quoteId: string,
): Promise<AuthorizedQuoteDownload> {
  if (!scope.userId) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { status: true, request: { select: { organizationId: true } } },
  });
  const decision = quote
    ? quoteDownloadDecision({
        isDesk: scope.isDesk,
        canActOnOwningOrg: canActOnOrg(scope, quote.request.organizationId),
        status: quote.status,
      })
    : "not_found";
  if (decision === "not_found") {
    return { ok: false, response: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }
  if (decision === "superseded") {
    return { ok: false, response: NextResponse.json({ error: "superseded" }, { status: 409 }) };
  }
  // The desk's own download names the desk member preparing it (they may
  // edit the DOCX before sending); a buyer's copy names whoever sent it.
  const preparedBy =
    decision === "desk"
      ? {
          name: scope.session?.user?.name ?? null,
          email: scope.session?.user?.email ?? DESK_PREPARED_BY.email,
        }
      : await quoteSender(quoteId);
  return { ok: true, userId: scope.userId, audience: decision, preparedBy };
}

// RFC 6266 attachment header with an ASCII fallback for old clients.
export function attachmentDisposition(filename: string): string {
  const asciiFallback = filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
