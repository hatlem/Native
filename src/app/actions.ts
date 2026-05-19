"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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

export async function removeFromPlan(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const productId = str(formData, "productId");
  const items = (await readBasket()).filter((i) => i.productId !== productId);
  await writeBasket(items);
  revalidatePath(`/${locale}/plan`);
}

export async function submitRequest(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const budgetRaw = str(formData, "budget");
  const goal = str(formData, "goal");
  const audience = str(formData, "audience");
  const brief = str(formData, "brief");

  // RFQ/checkout is account-bound: the request is owned by the buyer's
  // organization, so only they (and the desk) can later view or accept it.
  const session = await auth();
  const me = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        include: { organization: true },
      })
    : null;
  if (!me?.organization) {
    redirect(`/${locale}/signin`);
  }
  const org = me.organization;

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

  const store = await cookies();
  store.delete(PLAN_COOKIE);
  redirect(`/${locale}/requests/${request.id}`);
}

export async function generateQuote(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");

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

  await prisma.$transaction([
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

  // Only the owning organization (or the desk) may accept a quote.
  const session = await auth();
  const role = session?.user?.role;
  const isDesk = role === "DESK" || role === "SUPERADMIN";
  if (!isDesk) {
    const buyer = session?.user?.id
      ? await prisma.user.findUnique({
          where: { id: session.user.id },
          select: { organizationId: true },
        })
      : null;
    if (
      !buyer?.organizationId ||
      buyer.organizationId !== quote.request.organizationId
    ) {
      redirect(`/${locale}/signin`);
    }
  }
  if (quote.order) {
    redirect(`/${locale}/requests/${quote.requestId}`);
  }

  const plan = quote.request.plan;

  await prisma.$transaction(async (tx) => {
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
  });

  redirect(`/${locale}/requests/${quote.requestId}`);
}
