"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  computeQuoteLines,
  marginPctFromSell,
  quoteTotals,
  resolveDefaultMarginPct,
  type QuotableItem,
} from "@/lib/money";
import { loadPricingDefaults, contentFeeLinesForGroup } from "@/lib/content-fee";
import { toQuotable } from "@/lib/commerce/firm-order";
import { createOrderFromQuote } from "@/lib/commerce/accept-quote";
import { uniquePublisherIdsForProducts } from "@/lib/commerce/publishers";
import { groupItemsByMarket } from "@/lib/quote-grouping";
import { recordAudit } from "@/lib/audit";
import { notifyDesk, notifyOrg, notifyPublisher } from "@/lib/notify";
import { loadScope, canActOnOrg, canCommitOnOrg } from "@/lib/scope";
import { generateQuotePdf as renderQuotePdf } from "@/lib/pdf/generate-quote-pdf";

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

  // A still-unresolved Title placeholder (productId null) is priced as
  // "mangler produkt" (missing product) — it stays on the request, visible
  // and resolvable from the desk page, but is excluded from THIS quote
  // rather than blocking it. Silently dropping it from the request would
  // lose the placement; leaving it in Plan.items (untouched here) keeps it
  // resolvable and quotable later. Only block when NOTHING is quotable yet.
  const productItems = request.plan.items.filter((i) => i.productId);
  if (productItems.length === 0) {
    console.warn("quote.blocked", { reason: "nothing-resolved", requestId });
    redirect(`/${locale}/desk/${requestId}?error=unresolved-titles`);
  }
  const products = await prisma.product.findMany({
    where: { id: { in: productItems.map((i) => i.productId as string) } },
    include: {
      priceRules: true,
      title: { include: { market: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // One quote per placement market — same grouping rule submitRequest
  // uses, so a buyer who briefed across NO + SE + DE gets three quotes
  // each in its local currency and VAT.
  const groups = groupItemsByMarket(
    productItems.map((i) => ({ ...i, productId: i.productId as string })),
    byId,
  );
  if (groups.length === 0) redirect(`/${locale}/desk/${requestId}?error=empty`);

  // Fee rules and margin defaults come from the same load so the quote
  // agrees with the catalog band the buyer saw (display-price.ts).
  const defaults = await loadPricingDefaults();
  const validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  // A line quoted off an unconfirmed (blueprint-estimated) product price
  // must not present the estimate as a firm figure — it goes out as
  // "price on request" until the desk sets a concrete customer price.
  // The sibling content-fee line follows its placement: if the placement
  // itself is unpriced, so is the production fee folded into it.
  const priceOnRequestFor = (productId: string | null): boolean => {
    if (!productId) return false;
    const product = byId.get(productId);
    if (!product) return true;
    return product.confirmedAt === null || Number(product.basePrice) <= 0;
  };

  const created = await prisma.$transaction(async (tx) => {
    const quotes: {
      id: string;
      currency: string;
      total: number;
      onRequestCount: number;
    }[] = [];
    for (const group of groups) {
      const inventoryLines = computeQuoteLines(
        group.items
          .map((item) => {
            const product = byId.get(item.productId);
            return product ? toQuotable(product, item.quantity) : null;
          })
          .filter((q): q is QuotableItem => q !== null),
        resolveDefaultMarginPct(defaults.marginRules, group.marketCode),
      ).map((line) => ({
        ...line,
        priceOnRequest: priceOnRequestFor(line.productId),
      }));
      const onRequestNames = new Set(
        inventoryLines.filter((l) => l.priceOnRequest).map((l) => l.description),
      );
      const feeLines = contentFeeLinesForGroup(
        group.items,
        byId,
        group.marketCode,
        defaults.feeRules,
      ).map((line) => ({
        ...line,
        priceOnRequest: onRequestNames.has(
          line.description.replace(/^Content production — /, ""),
        ),
      }));
      const lines = [...inventoryLines, ...feeLines];
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
      quotes.push({
        id: quote.id,
        currency: group.currency,
        total,
        onRequestCount: lines.filter((l) => l.priceOnRequest).length,
      });
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
  const onRequestTotal = created.reduce((s, q) => s + q.onRequestCount, 0);
  await notifyOrg(request.organizationId, {
    kind: "QUOTE_READY",
    title:
      created.length === 1
        ? "Your quote is ready"
        : `Your ${created.length} quotes are ready`,
    body: `Total ${totalsBody}${
      onRequestTotal > 0
        ? ` (${onRequestTotal} line${onRequestTotal === 1 ? "" : "s"} priced on request)`
        : ""
    }, valid until ${validUntil.toISOString().slice(0, 10)}.`,
    link: `/${locale}/requests/${request.id}`,
  });

  redirect(`/${locale}/desk/${requestId}`);
}

// Desk override of one quote line's customer price. Two intents:
//   intent=set     — give the line a concrete customer total (prices a
//                    "pris på forespørsel" line, or reprices a priced one)
//   intent=onRequest — send the line out without an amount instead
// Only while the quote has no order: once a buyer accepted, the numbers
// they accepted are immutable. Every change stamps priceSetBy/At on the
// line and lands in AuditLog with the before/after amounts.
export async function setQuoteLinePrice(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");
  const quoteId = str(formData, "quoteId");
  const lineId = str(formData, "lineId");
  const intent = str(formData, "intent");

  const scope = await loadScope();
  if (!scope.isDesk || !scope.userId) redirect(`/${locale}/signin`);

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true, order: true },
  });
  if (!quote || quote.requestId !== requestId) {
    redirect(`/${locale}/desk/${requestId}`);
  }
  const line = quote.lines.find((l) => l.id === lineId);
  if (!line || quote.order) {
    redirect(`/${locale}/desk/${requestId}`);
  }

  let update: {
    priceOnRequest: boolean;
    lineTotal?: number;
    marginPct?: number;
  };
  if (intent === "onRequest") {
    update = { priceOnRequest: true };
  } else {
    // Accept "25 000", "25000.50", "25 000,50" — digits, spaces, one
    // decimal separator. Reject anything non-positive or unparseable.
    const raw = str(formData, "lineTotal").replace(/[\s ]/g, "").replace(",", ".");
    const lineTotal = Number(raw);
    if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
      redirect(`/${locale}/desk/${requestId}?error=bad-price`);
    }
    update = {
      priceOnRequest: false,
      lineTotal: Math.round(lineTotal),
      marginPct: marginPctFromSell(
        Number(line.unitCost),
        line.quantity,
        Math.round(lineTotal),
      ),
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.quoteLine.update({
      where: { id: line.id },
      data: {
        ...update,
        priceSetById: scope.userId,
        priceSetAt: new Date(),
      },
    });
    const lines = quote.lines.map((l) =>
      l.id === line.id
        ? {
            lineTotal: update.lineTotal ?? Number(l.lineTotal),
            priceOnRequest: update.priceOnRequest,
          }
        : {
            lineTotal: Number(l.lineTotal),
            priceOnRequest: l.priceOnRequest,
          },
    );
    const { subtotal, total } = quoteTotals(lines, Number(quote.vatPct));
    await tx.quote.update({
      where: { id: quote.id },
      data: { subtotal, total },
    });
  });

  await recordAudit(scope.userId, "quote.line.price", `QuoteLine:${line.id}`, {
    quoteId: quote.id,
    requestId,
    intent: update.priceOnRequest ? "onRequest" : "set",
    previousLineTotal: Number(line.lineTotal),
    previousPriceOnRequest: line.priceOnRequest,
    ...(update.lineTotal != null ? { lineTotal: update.lineTotal } : {}),
  });

  redirect(`/${locale}/desk/${requestId}`);
}

// Renders a new customer-safe PDF for an already-generated (frozen) Quote.
// Desk-only. Never touches pricing — see generate-quote-pdf.ts.
export async function generateQuotePdf(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const quoteId = str(formData, "quoteId");
  const requestId = str(formData, "requestId");

  const scope = await loadScope();
  if (!scope.isDesk || !scope.userId) redirect(`/${locale}/signin`);

  const doc = await renderQuotePdf({
    quoteId,
    locale,
    generatedById: scope.userId,
    preparedBy: {
      name: scope.session?.user?.name ?? null,
      email: scope.session?.user?.email ?? "desk@nativespin.com",
    },
  });

  await recordAudit(scope.userId, "quote.pdf.generate", `Quote:${quoteId}`, {
    documentId: doc.id,
    version: doc.version,
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

  // "Pris på forespørsel" lines carry no agreed amount — the buyer is
  // accepting the priced lines only; the rest is confirmed separately by
  // the desk. A quote with nothing priced has nothing to accept.
  const pricedLines = quote.lines.filter((l) => !l.priceOnRequest);
  if (pricedLines.length === 0) {
    redirect(`/${locale}/requests/${quote.requestId}`);
  }

  // Order/brief/booking creation + quote ACCEPTED live in the shared
  // accept-quote helper; the request close rides in the same transaction.
  const { orderId, productIds } = await prisma.$transaction(async (tx) => {
    const result = await createOrderFromQuote(tx, {
      organizationId: quote.request.organizationId,
      quote: { id: quote.id, lines: pricedLines },
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

  // Same rule as acceptQuote: only priced lines become order lines; a
  // quote whose every line is still "pris på forespørsel" is skipped
  // (nothing agreed to accept on it yet).
  const openQuotes = request.quotes
    .map((q) => ({ ...q, lines: q.lines.filter((l) => !l.priceOnRequest) }))
    .filter((q) => !q.order && q.lines.length > 0);
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
