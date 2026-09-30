// Quote lifecycle steps that talk to the buyer: the desk SENDING its draft
// quote(s), and the fan-out after a buyer ACCEPTS. Pure domain logic + DB +
// notifications — auth, form parsing and redirects stay in the server
// actions (quote-actions.ts), so these run and are tested without a session
// (see quote-lifecycle.it.test.ts).

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyDesk, notifyOrg, notifyPublisher } from "@/lib/notify";
import { marketDefaultLocale } from "@/lib/market-locale";
import { uniquePublisherIdsForProducts } from "@/lib/commerce/publishers";
import { buildDeskQuoteAcceptedNotice } from "@/lib/commerce/quote-notices";

export type SendDraftQuotesResult =
  // The drafts are SENT and the buyer org was notified.
  | { outcome: "sent"; quoteIds: string[] }
  // No unsent draft on the request (already sent, or never generated).
  | { outcome: "none" }
  // A draft has every line on "price on request" — nothing to accept yet.
  | { outcome: "unpriced" }
  // Another send won the race; nothing was changed here.
  | { outcome: "already-sent" }
  // A revision's predecessor is no longer an open offer — the buyer accepted
  // (or it was otherwise closed) while the revision was being drafted.
  // Nothing was sent; the revision can only be discarded.
  | { outcome: "predecessor-closed"; quoteIds: string[] };

class DraftAlreadySentError extends Error {}
class PredecessorClosedError extends Error {}

/**
 * Send every unsent DRAFT quote on a request to the buyer — the only step
 * that makes a quote visible and acceptable, and the only one that notifies
 * the buyer. All drafts go out together (one quote per placement market, one
 * inbox entry) with the validity the desk chose. The notice is built from the
 * stored totals AFTER the desk's pricing, so it carries the real amount.
 *
 * A draft that is a REVISION (quote-revision.ts) supersedes its predecessor in
 * the same transaction: the old quote becomes SUPERSEDED (never acceptable
 * again) at the instant the new one becomes SENT, so the buyer never holds two
 * live offers for the same market, nor none. The notice then says the quote
 * was revised.
 */
export async function sendDraftQuotes(input: {
  requestId: string;
  validUntil: Date;
  actorUserId: string | null;
}): Promise<SendDraftQuotesResult> {
  const { requestId, validUntil } = input;
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      organizationId: true,
      organization: { select: { marketCode: true } },
      plan: { select: { name: true } },
      quotes: {
        where: { status: "DRAFT", order: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          currency: true,
          total: true,
          revision: true,
          previousQuoteId: true,
          lines: { select: { priceOnRequest: true } },
        },
      },
    },
  });
  const drafts = request?.quotes ?? [];
  if (!request || drafts.length === 0) return { outcome: "none" };

  // A quote whose every line is still "price on request" offers nothing the
  // buyer could accept — exactly the empty "Total 0" offer this step exists
  // to prevent. The desk prices at least one line per market first.
  if (drafts.some((q) => q.lines.every((l) => l.priceOnRequest))) {
    return { outcome: "unpriced" };
  }

  // Compare-and-set on DRAFT: a double-click (or two desk users) sends once.
  // All-or-nothing — if any draft was sent concurrently, roll back rather
  // than notify the buyer twice.
  const predecessorIds = drafts
    .map((q) => q.previousQuoteId)
    .filter((id): id is string => id !== null);
  try {
    await prisma.$transaction(async (tx) => {
      // Supersede first: this compare-and-set races the buyer's accept, which
      // claims the same row on status SENT (accept-quote.ts). Whichever
      // commits first wins; the loser's count comes back short.
      if (predecessorIds.length > 0) {
        const superseded = await tx.quote.updateMany({
          where: {
            id: { in: predecessorIds },
            status: { in: ["SENT", "EXPIRED"] },
            order: null,
          },
          data: { status: "SUPERSEDED", supersededAt: new Date() },
        });
        if (superseded.count !== predecessorIds.length) throw new PredecessorClosedError();
      }
      const flipped = await tx.quote.updateMany({
        where: { id: { in: drafts.map((q) => q.id) }, status: "DRAFT" },
        data: { status: "SENT", validUntil },
      });
      if (flipped.count !== drafts.length) throw new DraftAlreadySentError();
      await tx.request.update({ where: { id: request.id }, data: { status: "QUOTED" } });
    });
  } catch (err) {
    if (err instanceof DraftAlreadySentError) return { outcome: "already-sent" };
    if (err instanceof PredecessorClosedError) {
      return { outcome: "predecessor-closed", quoteIds: drafts.map((q) => q.id) };
    }
    throw err;
  }

  for (const q of drafts) {
    await recordAudit(input.actorUserId, "quote.send", `Quote:${q.id}`, {
      requestId,
      total: Number(q.total),
      currency: q.currency,
      validUntil: validUntil.toISOString(),
      ...(q.previousQuoteId
        ? { revision: q.revision, supersedesQuoteId: q.previousQuoteId }
        : {}),
    });
  }

  // Written for the buyer org: the email in its home market's language (not
  // the desk associate's UI locale); the inbox row re-renders in each
  // reader's own language (lib/notice-template.ts).
  const marketCode = request.organization.marketCode;
  await notifyOrg(request.organizationId, {
    kind: "QUOTE_READY",
    locale: marketCode ? marketDefaultLocale(marketCode) : "en",
    template: {
      key: "quoteSent",
      params: {
        planName: request.plan.name,
        quotes: drafts.map((q) => ({ total: Number(q.total), currency: q.currency })),
        onRequestCount: drafts.reduce(
          (n, q) => n + q.lines.filter((l) => l.priceOnRequest).length,
          0,
        ),
        validUntil: validUntil.toISOString(),
        // "Your quote has been revised (revision N)" — the newest revision
        // number going out, when any draft replaces an earlier quote.
        ...(predecessorIds.length > 0
          ? { revision: Math.max(...drafts.filter((q) => q.previousQuoteId).map((q) => q.revision)) }
          : {}),
        requestId: request.id,
      },
    },
  });

  return { outcome: "sent", quoteIds: drafts.map((q) => q.id) };
}

/**
 * After a buyer accepts: confirm the order to the buyer org (in-app + email —
 * the counterpart of the instant path's "Order confirmed"), tell the desk and
 * fan out a booking to every publisher involved. Shared by the single and the
 * multi-market accept actions so they can't drift.
 */
export async function notifyQuoteAccepted(args: {
  organizationId: string;
  orgName: string;
  marketCode: string | null;
  planName: string;
  requestId: string;
  orders: { orderId: string; productIds: string[] }[];
  // UI locale of whoever accepted — used for the desk and publisher links,
  // as before; the buyer's own notice follows the org's market.
  actorLocale: string;
}): Promise<void> {
  const { orders } = args;
  await notifyOrg(args.organizationId, {
    kind: "QUOTE_ACCEPTED",
    locale: args.marketCode ? marketDefaultLocale(args.marketCode) : "en",
    template: {
      key: "orderConfirmed",
      params: {
        planName: args.planName,
        requestId: args.requestId,
        // One order: straight to it. Several (one per market): the request
        // page lists them all with a link to each.
        orderId: orders.length === 1 ? orders[0].orderId : null,
      },
    },
  });

  const desk = buildDeskQuoteAcceptedNotice({
    orgName: args.orgName,
    planName: args.planName,
    orderCount: orders.length,
  });
  await notifyDesk({
    kind: "QUOTE_ACCEPTED",
    title: desk.title,
    body: desk.body,
    link:
      orders.length === 1
        ? `/${args.actorLocale}/desk/orders/${orders[0].orderId}`
        : `/${args.actorLocale}/desk/orders`,
  });

  const pubIds = await uniquePublisherIdsForProducts(orders.flatMap((o) => o.productIds));
  await Promise.all(
    pubIds.map((pid) =>
      notifyPublisher(pid, {
        kind: "BOOKING_NEW",
        title: "New booking",
        body: "A confirmed order requires booking on your end.",
        link: `/${args.actorLocale}/publisher/orders`,
      }),
    ),
  );
}
