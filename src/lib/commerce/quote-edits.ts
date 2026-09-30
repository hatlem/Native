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
import {
  extraWorkHourlyRate,
  extraWorkLineTotal,
  type ExtraWorkRateSpec,
} from "@/lib/pricing/extra-work";

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
        select: { id: true, kind: true, unitCost: true, quantity: true, lineTotal: true, priceOnRequest: true },
      },
    },
  });
  if (!quote || quote.requestId !== input.requestId) return { outcome: "not-found" };
  const line = quote.lines.find((l) => l.id === input.lineId);
  // An extra-work line is priced by its hours (hours × rate): a free-typed
  // total would leave the hours it shows disagreeing with the amount.
  if (!line || line.kind === "EXTRA_WORK") return { outcome: "not-found" };

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

export type ExtraWorkLineRefusal =
  | QuoteLineEditRefusal
  // No ExtraWorkRate for the quote's currency: nothing to bill hours at.
  | { outcome: "no-rate" };

/**
 * Add an "Extra work / revision" line to a DRAFT quote: hours × the quote
 * currency's hourly rate (snapshotted on the line), placed last, and the
 * quote's totals recomputed. Same lock as a price edit: a sent quote is the
 * offer the buyer holds, so extra work agreed after that goes on the order
 * (lib/commerce/order-extra-work.ts), never onto the quote.
 */
export async function addQuoteExtraWorkLine(input: {
  requestId: string;
  quoteId: string;
  hours: number;
  description: string;
  rates: readonly ExtraWorkRateSpec[];
}): Promise<
  ExtraWorkLineRefusal | { outcome: "added"; lineId: string; lineTotal: number; hourlyRate: number }
> {
  const quote = await prisma.quote.findUnique({
    where: { id: input.quoteId },
    select: {
      id: true,
      requestId: true,
      currency: true,
      vatPct: true,
      lines: { select: { lineTotal: true, priceOnRequest: true, position: true } },
    },
  });
  if (!quote || quote.requestId !== input.requestId) return { outcome: "not-found" };
  const hourlyRate = extraWorkHourlyRate(input.rates, quote.currency);
  if (hourlyRate === null) return { outcome: "no-rate" };
  const lineTotal = extraWorkLineTotal(input.hours, hourlyRate);

  const { subtotal, total } = quoteTotals(
    [
      ...quote.lines.map((l) => ({ lineTotal: Number(l.lineTotal), priceOnRequest: l.priceOnRequest })),
      { lineTotal, priceOnRequest: false },
    ],
    Number(quote.vatPct),
  );
  const position = quote.lines.reduce((max, l) => Math.max(max, l.position + 1), 0);

  try {
    const line = await prisma.$transaction(async (tx) => {
      const claimed = await tx.quote.updateMany({
        where: { id: quote.id, ...editableQuoteWhere() },
        data: { subtotal, total },
      });
      if (claimed.count !== 1) throw new QuoteLockedError();
      return tx.quoteLine.create({
        data: {
          quoteId: quote.id,
          kind: "EXTRA_WORK",
          productId: null,
          description: input.description,
          quantity: 1,
          // Our own service: no publisher cost, so the whole line is revenue
          // (like a content fee).
          unitCost: 0,
          marginPct: 0,
          lineTotal,
          hours: input.hours,
          hourlyRate,
          position,
        },
        select: { id: true },
      });
    });
    return { outcome: "added", lineId: line.id, lineTotal, hourlyRate };
  } catch (err) {
    if (err instanceof QuoteLockedError) return { outcome: "locked" };
    throw err;
  }
}

/** Remove a desk-added extra-work line from a DRAFT quote. */
export async function removeQuoteExtraWorkLine(input: {
  requestId: string;
  quoteId: string;
  lineId: string;
}): Promise<QuoteLineEditRefusal | { outcome: "removed"; lineTotal: number }> {
  const quote = await prisma.quote.findUnique({
    where: { id: input.quoteId },
    select: {
      id: true,
      requestId: true,
      vatPct: true,
      lines: { select: { id: true, kind: true, lineTotal: true, priceOnRequest: true } },
    },
  });
  if (!quote || quote.requestId !== input.requestId) return { outcome: "not-found" };
  // Only the desk's own hours line: placements and article fees come from
  // the plan and are repriced, never deleted here.
  const line = quote.lines.find((l) => l.id === input.lineId && l.kind === "EXTRA_WORK");
  if (!line) return { outcome: "not-found" };

  const { subtotal, total } = quoteTotals(
    quote.lines
      .filter((l) => l.id !== line.id)
      .map((l) => ({ lineTotal: Number(l.lineTotal), priceOnRequest: l.priceOnRequest })),
    Number(quote.vatPct),
  );
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.quote.updateMany({
        where: { id: quote.id, ...editableQuoteWhere() },
        data: { subtotal, total },
      });
      if (claimed.count !== 1) throw new QuoteLockedError();
      await tx.quoteLine.delete({ where: { id: line.id } });
    });
  } catch (err) {
    if (err instanceof QuoteLockedError) return { outcome: "locked" };
    throw err;
  }
  return { outcome: "removed", lineTotal: Number(line.lineTotal) };
}
