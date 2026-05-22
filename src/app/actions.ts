"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import {
  PLAN_COOKIE,
  readBasket,
  serializeBasket,
  type BasketItem,
} from "@/lib/basket";
import {
  computeQuoteLines,
  quoteTotals,
  toRateRules,
  type QuotableItem,
} from "@/lib/money";
import { recordAudit } from "@/lib/audit";
import { notifyDesk, notifyOrg, notifyPublisher } from "@/lib/notify";
import { rfqLimiter } from "@/lib/rate-limit";
import { loadScope, canActOnOrg } from "@/lib/scope";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

async function writeBasket(items: BasketItem[]) {
  const store = await cookies();
  store.set(PLAN_COOKIE, serializeBasket(items), COOKIE_OPTS);
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

type ProductWithRules = {
  id: string;
  name: string;
  basePrice: unknown;
  priceRules: {
    marginPct: unknown;
    seasonalMultiplier: unknown;
    minVolume: number;
  }[];
};

function toQuotable(
  p: ProductWithRules,
  quantity: number,
): QuotableItem {
  return {
    productId: p.id,
    name: p.name,
    quantity,
    basePrice: Number(p.basePrice),
    rules: toRateRules(p.priceRules),
  };
}

export async function addToPlan(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const productId = str(formData, "productId");
  if (productId) {
    const items = await readBasket();
    const existing = items.find((i) => i.productId === productId);
    if (existing) existing.quantity += 1;
    else items.push({ productId, quantity: 1 });
    await writeBasket(items);
  }
  redirect(`/${locale}/plan`);
}

export async function addRecommendedPlan(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const ids = str(formData, "productIds")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length > 0) {
    const valid = await prisma.product.findMany({
      where: { id: { in: ids }, active: true, bookable: true },
      select: { id: true },
    });
    const validIds = new Set(valid.map((p) => p.id));
    const items = await readBasket();
    for (const id of ids) {
      if (!validIds.has(id)) continue;
      const existing = items.find((i) => i.productId === id);
      if (existing) existing.quantity += 1;
      else items.push({ productId: id, quantity: 1 });
    }
    await writeBasket(items);
  }
  redirect(`/${locale}/plan`);
}

export async function removeFromPlan(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const productId = str(formData, "productId");
  const items = (await readBasket()).filter((i) => i.productId !== productId);
  await writeBasket(items);
  revalidatePath(`/${locale}/plan`);
}

async function clientKey(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

export async function submitRequest(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const budgetRaw = str(formData, "budget");
  const goal = str(formData, "goal");
  const audience = str(formData, "audience");
  const brief = str(formData, "brief");

  // RFQ/checkout is account-bound: the request is owned by the acting
  // organization (an advertiser's own org, or the agency's selected
  // client) so only they, their agency, and the desk can view/accept it.
  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  if (!ws?.activeOrgId) {
    redirect(ws?.isAgency ? `/${locale}/agency` : `/${locale}/signin`);
  }

  if (!rfqLimiter.check(`rfq:${ws.activeOrgId}`).ok) {
    redirect(`/${locale}/plan?error=rate`);
  }

  const org = await prisma.organization.findUnique({
    where: { id: ws.activeOrgId },
  });
  if (!org) {
    redirect(`/${locale}/signin`);
  }

  const basket = await readBasket();
  if (basket.length === 0) {
    redirect(`/${locale}/plan?error=1`);
  }

  const market = await prisma.market.findUnique({
    where: { code: org.marketCode },
  });
  const currency = market?.currency ?? "EUR";

  const vatPct = market ? Number(market.vatRatePct) : 25;
  const products = await prisma.product.findMany({
    where: {
      id: { in: basket.map((b) => b.productId) },
      active: true,
      bookable: true,
    },
    include: { priceRules: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = basket.filter((b) => byId.has(b.productId));
  if (items.length === 0) redirect(`/${locale}/plan?error=1`);

  // Self-serve: an all-firm-priced basket needs no desk — auto-quote,
  // auto-accept and confirm the order immediately.
  const allFirm = items.every(
    (i) => byId.get(i.productId)?.visibility === "FIRM",
  );

  // Honour Phase-3 availability for FIRM (self-serve) baskets: block
  // the current month if any selected product is unavailable now. RFQ
  // baskets still go through the desk, which can negotiate around it.
  if (allFirm) {
    const now = new Date();
    const blocked = await prisma.availability.findFirst({
      where: {
        productId: { in: items.map((i) => i.productId) },
        year: now.getUTCFullYear(),
        month: now.getUTCMonth() + 1,
        blocked: true,
      },
      select: { productId: true },
    });
    if (blocked) redirect(`/${locale}/plan?error=availability`);
  }

  const request = await prisma.$transaction(async (tx) => {
    const plan = await tx.plan.create({
      data: {
        organizationId: org.id,
        name: `${org.name} — campaign`,
        budget: budgetRaw ? Number(budgetRaw) || null : null,
        currency,
        goal: goal || null,
        audienceNote: audience || null,
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
          })),
        },
      },
    });

    const req = await tx.request.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        status: allFirm ? "CLOSED" : "SUBMITTED",
        briefSummary: brief || null,
      },
    });

    if (allFirm) {
      const lines = computeQuoteLines(
        items.map((i) => toQuotable(byId.get(i.productId)!, i.quantity)),
      );
      const { subtotal, total } = quoteTotals(lines, vatPct);

      const quote = await tx.quote.create({
        data: {
          requestId: req.id,
          status: "ACCEPTED",
          currency,
          subtotal,
          vatPct,
          total,
          validUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          lines: { create: lines },
        },
      });
      const order = await tx.order.create({
        data: {
          organizationId: org.id,
          quoteId: quote.id,
          status: "CONFIRMED",
          lines: {
            create: lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              lineTotal: l.lineTotal,
            })),
          },
        },
        include: { lines: true },
      });
      await tx.contentBrief.createMany({
        data: order.lines.map((l) => ({
          orderLineId: l.id,
          message: goal || null,
          audience: audience || null,
        })),
      });
      await tx.publisherBooking.createMany({
        data: order.lines.map((l) => ({ orderLineId: l.id })),
      });
    }

    return req;
  });

  await recordAudit(session?.user?.id ?? null, "request.submit", `Request:${request.id}`, {
    orgId: org.id,
    allFirm,
    ip: await clientKey(),
  });
  if (allFirm) {
    // Self-serve confirmation: notify the buying org and every publisher
    // whose products are in the order so they see the booking instantly.
    await notifyOrg(org.id, {
      kind: "QUOTE_ACCEPTED",
      title: "Order confirmed",
      body: "Your firm-priced order has been confirmed.",
      link: `/${locale}/requests/${request.id}`,
    });
    const pubIds = await uniquePublisherIdsForProducts(items.map((i) => i.productId));
    await Promise.all(
      pubIds.map((pid) =>
        notifyPublisher(pid, {
          kind: "BOOKING_NEW",
          title: "New booking",
          body: `${org.name} confirmed an instant-book order.`,
          link: `/${locale}/publisher/orders`,
        }),
      ),
    );
  } else {
    await notifyDesk({
      kind: "RFQ_SUBMITTED",
      title: "New RFQ",
      body: `${org.name} submitted ${items.length} item(s).`,
      link: `/${locale}/desk/${request.id}`,
    });
  }

  const store = await cookies();
  store.delete(PLAN_COOKIE);
  redirect(`/${locale}/requests/${request.id}`);
}

async function uniquePublisherIdsForProducts(productIds: string[]): Promise<string[]> {
  if (productIds.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { title: { select: { publisherId: true } } },
  });
  return [...new Set(rows.map((r) => r.title.publisherId))];
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

  const market = await prisma.market.findUnique({
    where: { code: request.organization.marketCode },
  });
  const vatPct = market ? Number(market.vatRatePct) : 25;
  const currency = market?.currency ?? request.plan.currency ?? "EUR";

  const products = await prisma.product.findMany({
    where: { id: { in: request.plan.items.map((i) => i.productId) } },
    include: { priceRules: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = computeQuoteLines(
    request.plan.items
      .map((item) => {
        const product = byId.get(item.productId);
        return product ? toQuotable(product, item.quantity) : null;
      })
      .filter((q): q is QuotableItem => q !== null),
  );

  const { subtotal, total } = quoteTotals(lines, vatPct);
  const validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const [quote] = await prisma.$transaction([
    prisma.quote.create({
      data: {
        requestId: request.id,
        status: "SENT",
        currency,
        subtotal,
        vatPct,
        total,
        validUntil,
        lines: { create: lines },
      },
    }),
    prisma.request.update({
      where: { id: request.id },
      data: { status: "QUOTED" },
    }),
  ]);

  await recordAudit(scope.userId, "quote.create", `Quote:${quote.id}`, {
    requestId,
    total,
    currency,
  });
  await notifyOrg(request.organizationId, {
    kind: "QUOTE_READY",
    title: "Your quote is ready",
    body: `Total ${total} ${currency}, valid until ${validUntil.toISOString().slice(0, 10)}.`,
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
      request: { include: { plan: true } },
    },
  });
  if (!quote) redirect(`/${locale}/catalog`);

  // Only the owning organization, its agency, or the desk may accept.
  const scope = await loadScope();
  if (!canActOnOrg(scope, quote.request.organizationId)) {
    redirect(`/${locale}/signin`);
  }
  if (quote.order) {
    redirect(`/${locale}/requests/${quote.requestId}`);
  }

  const plan = quote.request.plan;

  const order = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        organizationId: quote.request.organizationId,
        quoteId: quote.id,
        status: "CONFIRMED",
        lines: {
          create: quote.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            lineTotal: l.lineTotal,
          })),
        },
      },
      include: { lines: true },
    });

    await tx.contentBrief.createMany({
      data: order.lines.map((line) => ({
        orderLineId: line.id,
        message: plan.goal,
        audience: plan.audienceNote,
      })),
    });
    await tx.publisherBooking.createMany({
      data: order.lines.map((line) => ({ orderLineId: line.id })),
    });

    await tx.quote.update({
      where: { id: quote.id },
      data: { status: "ACCEPTED" },
    });
    await tx.request.update({
      where: { id: quote.requestId },
      data: { status: "CLOSED" },
    });
    return order;
  });

  await recordAudit(scope.userId, "quote.accept", `Quote:${quote.id}`, {
    requestId: quote.requestId,
    orderId: order.id,
  });
  await notifyDesk({
    kind: "QUOTE_ACCEPTED",
    title: "Quote accepted",
    body: "A buyer accepted a quote — order is now confirmed.",
    link: `/${locale}/desk/orders/${order.id}`,
  });
  const pubIds = await uniquePublisherIdsForProducts(quote.lines.map((l) => l.productId));
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
