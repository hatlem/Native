"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  computeQuoteLines,
  quoteTotals,
  type QuotableItem,
} from "@/lib/money";
import { loadContentFeeRules, contentFeeLinesForGroup } from "@/lib/content-fee";
import { toQuotable } from "@/lib/commerce/firm-order";
import { createOrderFromQuote } from "@/lib/commerce/accept-quote";
import { uniquePublisherIdsForProducts } from "@/lib/commerce/publishers";
import { groupItemsByMarket } from "@/lib/quote-grouping";
import { recordAudit } from "@/lib/audit";
import { notifyDesk, notifyOrg, notifyPublisher } from "@/lib/notify";
import { loadScope, canActOnOrg, canCommitOnOrg } from "@/lib/scope";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function generateQuote(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");

  // Only the desk can produce a quote — previously any caller could POST.
  const scope = await loadScope();
  if (!scope.isDesk) redirect(`/${locale}/signin`);

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      organization: true,
      plan: { include: { items: true } },
      quotes: true,
    },
  });
  if (!request) redirect(`/${locale}/desk`);
  if (request.quotes.length > 0) {
    redirect(`/${locale}/desk/${requestId}`);
  }

  const products = await prisma.product.findMany({
    where: { id: { in: request.plan.items.map((i) => i.productId) } },
    include: {
      priceRules: true,
      title: { include: { market: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // One quote per placement market — same grouping rule submitRequest
  // uses, so a buyer who briefed across NO + SE + DE gets three quotes
  // each in its local currency and VAT.
  const groups = groupItemsByMarket(request.plan.items, byId);
  if (groups.length === 0) redirect(`/${locale}/desk`);

  const feeRules = await loadContentFeeRules();
  const validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const created = await prisma.$transaction(async (tx) => {
    const quotes: { id: string; currency: string; total: number }[] = [];
    for (const group of groups) {
      const lines = [
        ...computeQuoteLines(
          group.items
            .map((item) => {
              const product = byId.get(item.productId);
              return product ? toQuotable(product, item.quantity) : null;
            })
            .filter((q): q is QuotableItem => q !== null),
        ),
        ...contentFeeLinesForGroup(
          group.items,
          byId,
          group.marketCode,
          feeRules,
        ),
      ];
      const { subtotal, total } = quoteTotals(lines, group.vatPct);
      const quote = await tx.quote.create({
        data: {
          requestId: request.id,
          status: "SENT",
          currency: group.currency,
          subtotal,
          vatPct: group.vatPct,
          total,
          validUntil,
          lines: { create: lines },
        },
      });
      quotes.push({ id: quote.id, currency: group.currency, total });
    }
    await tx.request.update({
      where: { id: request.id },
      data: { status: "QUOTED" },
    });
    return quotes;
  });

  for (const q of created) {
    await recordAudit(scope.userId, "quote.create", `Quote:${q.id}`, {
      requestId,
      total: q.total,
      currency: q.currency,
    });
  }
  // One QUOTE_READY notification per request — body summarises totals
  // across the currencies so the buyer sees a single inbox entry even
  // for a multi-market campaign.
  const totalsBody = created
    .map((q) => `${q.total} ${q.currency}`)
    .join(" + ");
  await notifyOrg(request.organizationId, {
    kind: "QUOTE_READY",
    title:
      created.length === 1
        ? "Your quote is ready"
        : `Your ${created.length} quotes are ready`,
    body: `Total ${totalsBody}, valid until ${validUntil
      .toISOString()
      .slice(0, 10)}.`,
    link: `/${locale}/requests/${request.id}`,
  });

  redirect(`/${locale}/desk/${requestId}`);
}

export async function acceptQuote(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const quoteId = str(formData, "quoteId");

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      lines: true,
      order: true,
      request: { include: { plan: { include: { items: true } } } },
    },
  });
  if (!quote) redirect(`/${locale}/catalog`);

  // Only the owning organization, its agency, or the desk may accept.
  const scope = await loadScope();
  if (!canActOnOrg(scope, quote.request.organizationId)) {
    redirect(`/${locale}/signin`);
  }
  if (!canCommitOnOrg(scope, quote.request.organizationId)) {
    redirect(`/${locale}/signin`);
  }
  if (quote.order) {
    redirect(`/${locale}/requests/${quote.requestId}`);
  }

  // Order/brief/booking creation + quote ACCEPTED live in the shared
  // accept-quote helper; the request close rides in the same transaction.
  const { orderId, productIds } = await prisma.$transaction(async (tx) => {
    const result = await createOrderFromQuote(tx, {
      organizationId: quote.request.organizationId,
      quote: { id: quote.id, lines: quote.lines },
      plan: quote.request.plan,
    });
    await tx.request.update({
      where: { id: quote.requestId },
      data: { status: "CLOSED" },
    });
    return result;
  });

  await recordAudit(scope.userId, "quote.accept", `Quote:${quote.id}`, {
    requestId: quote.requestId,
    orderId,
  });
  await notifyDesk({
    kind: "QUOTE_ACCEPTED",
    title: "Quote accepted",
    body: "A buyer accepted a quote — order is now confirmed.",
    link: `/${locale}/desk/orders/${orderId}`,
  });
  const pubIds = await uniquePublisherIdsForProducts(productIds);
  await Promise.all(
    pubIds.map((pid) =>
      notifyPublisher(pid, {
        kind: "BOOKING_NEW",
        title: "New booking",
        body: "A confirmed order requires booking on your end.",
        link: `/${locale}/publisher/orders`,
      }),
    ),
  );

  redirect(`/${locale}/requests/${quote.requestId}`);
}

// Accept every still-open Quote on a Request in a single transaction.
// Used when the Request was split into multiple Quotes (one per
// placement market). A single buyer click maps the entire campaign
// from "quotes ready" to "orders confirmed" — partial failures roll
// the whole thing back so the buyer never gets half a campaign live.
// Existing acceptQuote stays for desk-side single-quote operations.
export async function acceptAllQuotesForRequest(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      plan: { include: { items: true } },
      quotes: { include: { lines: true, order: true } },
    },
  });
  if (!request) redirect(`/${locale}/catalog`);

  const scope = await loadScope();
  if (!canActOnOrg(scope, request.organizationId)) {
    redirect(`/${locale}/signin`);
  }
  if (!canCommitOnOrg(scope, request.organizationId)) {
    redirect(`/${locale}/signin`);
  }

  const openQuotes = request.quotes.filter((q) => !q.order);
  if (openQuotes.length === 0) {
    redirect(`/${locale}/requests/${request.id}`);
  }

  const createdOrders = await prisma.$transaction(async (tx) => {
    const orders: { orderId: string; productIds: string[] }[] = [];
    for (const quote of openQuotes) {
      orders.push(
        await createOrderFromQuote(tx, {
          organizationId: request.organizationId,
          quote: { id: quote.id, lines: quote.lines },
          plan: request.plan,
        }),
      );
    }
    await tx.request.update({
      where: { id: request.id },
      data: { status: "CLOSED" },
    });
    return orders;
  });

  for (const o of createdOrders) {
    await recordAudit(scope.userId, "quote.accept", `Order:${o.orderId}`, {
      requestId: request.id,
    });
  }
  await notifyDesk({
    kind: "QUOTE_ACCEPTED",
    title:
      createdOrders.length === 1
        ? "Quote accepted"
        : `${createdOrders.length} quotes accepted`,
    body: "A buyer accepted a multi-market campaign — orders confirmed.",
    link: `/${locale}/desk/orders`,
  });
  const allProductIds = createdOrders.flatMap((o) => o.productIds);
  const pubIds = await uniquePublisherIdsForProducts(allProductIds);
  await Promise.all(
    pubIds.map((pid) =>
      notifyPublisher(pid, {
        kind: "BOOKING_NEW",
        title: "New booking",
        body: "A confirmed order requires booking on your end.",
        link: `/${locale}/publisher/orders`,
      }),
    ),
  );

  redirect(`/${locale}/requests/${request.id}`);
}
