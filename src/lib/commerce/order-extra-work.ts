// Extra work on an ORDER: hours agreed after the buyer accepted the quote
// (an extra revision round, an interview, images). The accepted quote is
// immutable (quote-edits.ts), so these live on OrderExtraWork and become
// invoice lines when the invoice is issued (lib/billing.ts).
//
// Domain logic + DB only: auth, form parsing and redirects stay in the
// server action (desk-billing-actions.ts), so integration tests drive it
// without a session.
//
// Both writes are compare-and-set on the order row: they only land while the
// order is on the production flow and not invoiced (order-lifecycle.ts
// extraWorkBlock). The invoice issue claims the same row (COMPLETED →
// INVOICED) before it reads the entries, so an entry is either on the
// invoice or refused — never added to an order whose invoice already went
// out without it.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EXTRA_WORK_ORDER_STATUS_LIST, extraWorkBlock, type ExtraWorkBlock } from "@/lib/order-lifecycle";
import {
  extraWorkHourlyRate,
  extraWorkLineTotal,
  type ExtraWorkRateSpec,
} from "@/lib/pricing/extra-work";

export type OrderExtraWorkRefusal =
  | { outcome: "not-found" }
  | { outcome: "no-rate" }
  | { outcome: "locked"; reason: ExtraWorkBlock };

class OrderLockedError extends Error {}

async function lockOpenOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  // Touching updatedAt takes the order's row lock, and the status filter is
  // re-evaluated after any concurrent invoice issue commits.
  const claimed = await tx.order.updateMany({
    where: {
      id: orderId,
      status: { in: EXTRA_WORK_ORDER_STATUS_LIST },
      invoices: { none: { status: { in: ["DRAFT", "ISSUED", "PAID", "OVERDUE"] } } },
    },
    data: { updatedAt: new Date() },
  });
  if (claimed.count !== 1) throw new OrderLockedError();
}

export async function addOrderExtraWork(input: {
  orderId: string;
  hours: number;
  description: string;
  actorUserId: string;
  rates: readonly ExtraWorkRateSpec[];
}): Promise<
  | OrderExtraWorkRefusal
  | { outcome: "added"; entryId: string; lineTotal: number; hourlyRate: number; currency: string }
> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      status: true,
      quote: { select: { currency: true } },
      invoices: { select: { id: true, status: true } },
    },
  });
  if (!order) return { outcome: "not-found" };
  const block = extraWorkBlock(order.status, order.invoices);
  if (block) return { outcome: "locked", reason: block };
  const currency = order.quote.currency;
  const hourlyRate = extraWorkHourlyRate(input.rates, currency);
  if (hourlyRate === null) return { outcome: "no-rate" };
  const lineTotal = extraWorkLineTotal(input.hours, hourlyRate);

  try {
    const entry = await prisma.$transaction(async (tx) => {
      await lockOpenOrder(tx, order.id);
      return tx.orderExtraWork.create({
        data: {
          orderId: order.id,
          description: input.description,
          hours: input.hours,
          hourlyRate,
          currency,
          lineTotal,
          createdById: input.actorUserId,
        },
        select: { id: true },
      });
    });
    return { outcome: "added", entryId: entry.id, lineTotal, hourlyRate, currency };
  } catch (err) {
    if (err instanceof OrderLockedError) return { outcome: "locked", reason: "invoiced" };
    throw err;
  }
}

/** Remove an entry that has not been invoiced yet. */
export async function removeOrderExtraWork(input: {
  orderId: string;
  entryId: string;
}): Promise<OrderExtraWorkRefusal | { outcome: "removed"; lineTotal: number }> {
  const entry = await prisma.orderExtraWork.findUnique({
    where: { id: input.entryId },
    select: {
      id: true,
      orderId: true,
      invoiceId: true,
      lineTotal: true,
      order: { select: { status: true, invoices: { select: { id: true, status: true } } } },
    },
  });
  if (!entry || entry.orderId !== input.orderId) return { outcome: "not-found" };
  if (entry.invoiceId) return { outcome: "locked", reason: "invoiced" };
  const block = extraWorkBlock(entry.order.status, entry.order.invoices);
  if (block) return { outcome: "locked", reason: block };

  try {
    await prisma.$transaction(async (tx) => {
      await lockOpenOrder(tx, entry.orderId);
      const { count } = await tx.orderExtraWork.deleteMany({ where: { id: entry.id, invoiceId: null } });
      if (count !== 1) throw new OrderLockedError();
    });
  } catch (err) {
    if (err instanceof OrderLockedError) return { outcome: "locked", reason: "invoiced" };
    throw err;
  }
  return { outcome: "removed", lineTotal: Number(entry.lineTotal) };
}
