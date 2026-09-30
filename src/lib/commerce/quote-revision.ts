// Quote revisions: how a quote the buyer already holds gets changed.
//
// A SENT quote is immutable (quote-validity isQuoteEditable). To change one,
// the desk opens a revision: a new DRAFT on the same request that copies the
// lines, carries the next revision number and links back to its predecessor.
// The desk edits the draft like any other, then sends it through the normal
// send (quote-lifecycle sendDraftQuotes), which — in the same transaction —
// flips the predecessor to SUPERSEDED and notifies the buyer once with the
// revision's total. Until then the predecessor stays the live offer: the buyer
// can still accept it, and if they do, the revision can no longer be sent.
//
// Domain logic + DB only; auth, forms and redirects stay in quote-actions.ts.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { isQuoteRevisable } from "@/lib/commerce/quote-validity";

export type ReviseQuoteResult =
  // A new DRAFT revision was opened.
  | { outcome: "created"; quoteId: string; revision: number }
  // The quote already has a revision (a double-click, or a colleague got
  // there first) — that one is the quote to work on.
  | { outcome: "exists"; quoteId: string }
  // Not an offer that can be revised: a DRAFT is edited directly, an
  // ACCEPTED/ordered quote is an order, DECLINED/SUPERSEDED are closed.
  | { outcome: "not-revisable"; status: string | null };

/**
 * Open a DRAFT revision of a SENT (or EXPIRED) quote. The copy keeps every
 * line exactly as the buyer saw it — price, "on request" state, note,
 * position and who set the price — so the desk changes only what it means to
 * change. It has no validity yet (set when it is sent) and is invisible to the
 * buyer (buyerVisibleQuoteWhere) until then.
 */
export async function reviseQuote(input: {
  quoteId: string;
  actorUserId: string | null;
}): Promise<ReviseQuoteResult> {
  const source = await prisma.quote.findUnique({
    where: { id: input.quoteId },
    select: {
      id: true,
      requestId: true,
      status: true,
      currency: true,
      subtotal: true,
      vatPct: true,
      total: true,
      notes: true,
      revision: true,
      order: { select: { id: true } },
      nextRevision: { select: { id: true } },
      lines: {
        select: {
          kind: true,
          productId: true,
          description: true,
          quantity: true,
          unitCost: true,
          marginPct: true,
          lineTotal: true,
          availability: true,
          priceOnRequest: true,
          priceSetById: true,
          priceSetAt: true,
          customerNote: true,
          position: true,
          // An extra-work line carries its hours × rate into the revision.
          hours: true,
          hourlyRate: true,
        },
      },
    },
  });
  if (!source) return { outcome: "not-revisable", status: null };
  if (source.nextRevision) return { outcome: "exists", quoteId: source.nextRevision.id };
  if (!isQuoteRevisable(source)) return { outcome: "not-revisable", status: source.status };

  let revision: { id: string; revision: number };
  try {
    revision = await prisma.quote.create({
      data: {
        requestId: source.requestId,
        status: "DRAFT",
        currency: source.currency,
        subtotal: source.subtotal,
        vatPct: source.vatPct,
        total: source.total,
        notes: source.notes,
        // A draft makes no offer yet; the send sets the window.
        validUntil: null,
        revision: source.revision + 1,
        previousQuoteId: source.id,
        lines: { create: source.lines },
      },
      select: { id: true, revision: true },
    });
  } catch (err) {
    // Quote.previousQuoteId is unique: a concurrent "Revise" already opened
    // the revision. Hand back that one instead of failing.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.quote.findUnique({
        where: { previousQuoteId: source.id },
        select: { id: true },
      });
      if (existing) return { outcome: "exists", quoteId: existing.id };
    }
    throw err;
  }

  await recordAudit(input.actorUserId, "quote.revise", `Quote:${revision.id}`, {
    requestId: source.requestId,
    previousQuoteId: source.id,
    revision: revision.revision,
  });
  return { outcome: "created", quoteId: revision.id, revision: revision.revision };
}

export type DiscardRevisionResult =
  | { outcome: "discarded"; previousQuoteId: string }
  // Not an unsent revision (already sent, never a revision, or gone).
  | { outcome: "not-discardable" };

/**
 * Throw away an unsent revision — the desk changed its mind. Only a DRAFT that
 * IS a revision: an original draft is the request's only quote, and a sent
 * revision is an offer the buyer holds. The predecessor was never touched, so
 * it simply stays the live offer (and becomes revisable again).
 */
export async function discardQuoteRevision(input: {
  quoteId: string;
  actorUserId: string | null;
}): Promise<DiscardRevisionResult> {
  const draft = await prisma.quote.findUnique({
    where: { id: input.quoteId },
    select: { id: true, requestId: true, previousQuoteId: true, revision: true },
  });
  if (!draft?.previousQuoteId) return { outcome: "not-discardable" };
  const previousQuoteId = draft.previousQuoteId;

  try {
    await prisma.$transaction(async (tx) => {
      // Compare-and-set on "still an unsent draft revision", taken FIRST so it
      // row-locks the quote: a send racing this discard either waits and then
      // finds nothing to send, or has already won and nothing is deleted.
      const claimed = await tx.quote.updateMany({
        where: { id: draft.id, status: "DRAFT", order: null, previousQuoteId: { not: null } },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== 1) throw new RevisionNotDiscardableError();
      await tx.quoteLine.deleteMany({ where: { quoteId: draft.id } });
      // A PDF rendered from the draft for internal review goes with it.
      await tx.quoteDocument.deleteMany({ where: { quoteId: draft.id } });
      await tx.quote.delete({ where: { id: draft.id } });
    });
  } catch (err) {
    if (err instanceof RevisionNotDiscardableError) return { outcome: "not-discardable" };
    throw err;
  }

  await recordAudit(input.actorUserId, "quote.revision_discard", `Quote:${draft.id}`, {
    requestId: draft.requestId,
    previousQuoteId,
    revision: draft.revision,
  });
  return { outcome: "discarded", previousQuoteId };
}

class RevisionNotDiscardableError extends Error {}
