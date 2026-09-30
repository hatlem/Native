// Desk edits to a quote's lines: the customer price and the customer note.
// Domain logic + DB only — auth, form parsing and redirects stay in the
// server actions (quote-actions.ts), so the immutability rule is exercised
// without a session (quote-revision.it.test.ts).
//
// The rule: only a DRAFT's lines change (quote-validity isQuoteEditable). A
// SENT quote is the offer the buyer holds; the desk used to be able to reprice
// it without the buyer being told. Every write here is a compare-and-set on
// editableQuoteWhere inside the same transaction, so an edit racing the
// quote's send (or an old form posted after it) changes nothing.

import { prisma } from "@/lib/prisma";
import { marginPctFromSell, quoteTotals } from "@/lib/money";
import { editableQuoteWhere } from "@/lib/commerce/quote-validity";

export type QuoteLineEditRefusal =
  // No such line on this quote (or the quote isn't on this request).
  | { outcome: "not-found" }
  // The quote was sent (or ordered) — its lines are locked; revise it instead.
  | { outcome: "locked" };

class QuoteLockedError extends Error {}

export type LinePriceChange =
  // Give the line a concrete customer total (prices a "pris på forespørsel"
  // line, or reprices a priced one). Already validated as a positive amount.
  | { intent: "set"; lineTotal: number }
  // Send the line out without an amount instead.
  | { intent: "onRequest" };

/**
 * Set one line's customer price on a DRAFT quote and recompute the quote's
 * totals. Stamps priceSetBy/At on the line; the caller records the audit
 * entry (it has the before/after amounts in the result).
 */
export async function updateQuoteLinePrice(input: {
  requestId: string;
  quoteId: string;
  lineId: string;
  change: LinePriceChange;
  actorUserId: string;
}): Promise<
  | QuoteLineEditRefusal
  | {
      outcome: "updated";
      previous: { lineTotal: number; priceOnRequest: boolean };
      lineTotal: number | null;
    }
> {
  const quote = await prisma.quote.findUnique({
    where: { id: input.quoteId },
    select: {
      id: true,
      requestId: true,
      vatPct: true,
      lines: {
        select: { id: true, unitCost: true, quantity: true, lineTotal: true, priceOnRequest: true },
      },
    },
  });
  if (!quote || quote.requestId !== input.requestId) return { outcome: "not-found" };
  const line = quote.lines.find((l) => l.id === input.lineId);
  if (!line) return { outcome: "not-found" };

  // null = "on request": the line keeps its stored amount but goes out without it.
  const newTotal = input.change.intent === "set" ? Math.round(input.change.lineTotal) : null;
  const update =
    newTotal === null
      ? { priceOnRequest: true }
      : {
          priceOnRequest: false,
          lineTotal: newTotal,
          marginPct: marginPctFromSell(Number(line.unitCost), line.quantity, newTotal),
        };

  const lines = quote.lines.map((l) =>
    l.id === line.id
      ? { lineTotal: newTotal ?? Number(l.lineTotal), priceOnRequest: newTotal === null }
      : { lineTotal: Number(l.lineTotal), priceOnRequest: l.priceOnRequest },
  );
  const { subtotal, total } = quoteTotals(lines, Number(quote.vatPct));

  try {
    await prisma.$transaction(async (tx) => {
      // The totals write doubles as the lock: it only matches while the quote
      // is still an unordered DRAFT, and it row-locks the quote so a
      // concurrent send waits for this edit (or this edit sees the send).
      const claimed = await tx.quote.updateMany({
        where: { id: quote.id, ...editableQuoteWhere() },
        data: { subtotal, total },
      });
      if (claimed.count !== 1) throw new QuoteLockedError();
      await tx.quoteLine.update({
        where: { id: line.id },
        data: { ...update, priceSetById: input.actorUserId, priceSetAt: new Date() },
      });
    });
  } catch (err) {
    if (err instanceof QuoteLockedError) return { outcome: "locked" };
    throw err;
  }

  return {
    outcome: "updated",
    previous: { lineTotal: Number(line.lineTotal), priceOnRequest: line.priceOnRequest },
    lineTotal: newTotal,
  };
}

/** Set (or clear, with null) one line's customer-visible note on a DRAFT quote. */
export async function updateQuoteLineNote(input: {
  requestId: string;
  quoteId: string;
  lineId: string;
  note: string | null;
}): Promise<QuoteLineEditRefusal | { outcome: "updated"; hadNote: boolean }> {
  const line = await prisma.quoteLine.findUnique({
    where: { id: input.lineId },
    select: { id: true, customerNote: true, quote: { select: { id: true, requestId: true } } },
  });
  if (!line || line.quote.id !== input.quoteId || line.quote.requestId !== input.requestId) {
    return { outcome: "not-found" };
  }
  // Same compare-and-set as the price: the write only lands while the line's
  // quote is still an editable draft.
  const { count } = await prisma.quoteLine.updateMany({
    where: { id: line.id, quote: editableQuoteWhere() },
    data: { customerNote: input.note },
  });
  if (count !== 1) return { outcome: "locked" };
  return { outcome: "updated", hadNote: line.customerNote !== null };
}
