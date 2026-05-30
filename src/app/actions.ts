"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireOnboardingBeforeBuy } from "@/lib/onboarding-gate";
import { getWorkspace } from "@/lib/workspace";
import {
  PLAN_COOKIE,
  PLAN_BRIEF_COOKIE,
  clampQuantity,
  planBriefHasContent,
  readBasket,
  serializeBasket,
  serializePlanBrief,
  type BasketItem,
} from "@/lib/basket";
import {
  computeQuoteLines,
  quoteTotals,
  toRateRules,
  type QuotableItem,
} from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { loadContentFeeRules, contentFeeLinesForGroup } from "@/lib/content-fee";
import { groupItemsByMarket } from "@/lib/quote-grouping";
import { recordAudit } from "@/lib/audit";
import { notifyDesk, notifyOrg, notifyPublisher } from "@/lib/notify";
import { rfqLimiter } from "@/lib/rate-limit";
import { loadScope, canActOnOrg, canCommitOnOrg } from "@/lib/scope";

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

// Set the quantity for one plan line directly (the plan-page stepper).
// addToPlan keeps incrementing on catalog re-add; this lets the buyer
// set an exact value. Clamped to [1, MAX_QTY]; never removes a line
// (Remove is its own action).
export async function setQuantity(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const productId = str(formData, "productId");
  const qty = clampQuantity(Number(str(formData, "quantity")));
  if (productId) {
    const items = await readBasket();
    const existing = items.find((i) => i.productId === productId);
    if (existing) {
      existing.quantity = qty;
      await writeBasket(items);
    }
  }
  redirect(`/${locale}/plan`);
}

// Toggle whether NativeSpin produces the content for one plan line.
// Drives a CONTENT_FEE quote line at submit time. withContent="1" turns
// it on, anything else off.
export async function setContentProduction(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const productId = str(formData, "productId");
  const on = str(formData, "withContent") === "1";
  if (productId) {
    const items = await readBasket();
    const existing = items.find((i) => i.productId === productId);
    if (existing) {
      existing.withContent = on;
      await writeBasket(items);
    }
  }
  redirect(`/${locale}/plan`);
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

  // Stash the brief draft before the onboarding gate may detour the
  // user away — /plan rehydrates the form from this cookie on return
  // so the buyer doesn't have to re-type budget/audience/goal/brief.
  // Cleared at the end of this action on success.
  const briefDraft = {
    budget: budgetRaw,
    audience,
    goal,
    brief,
  };
  if (planBriefHasContent(briefDraft)) {
    const store = await cookies();
    store.set(PLAN_BRIEF_COOKIE, serializePlanBrief(briefDraft), COOKIE_OPTS);
  }

  // Buyer onboarding is deferred to the moment of buying intent: the
  // desk needs a reachable phone number, and the billing market drives
  // VAT + invoice currency on the Quote we're about to mint. Bounces
  // to /onboarding?next=/plan so the user lands back on the basket
  // with brief intact (cookie-backed) after filling in the two fields.
  await requireOnboardingBeforeBuy(session, locale, `/${locale}/plan`);

  if (!(await rfqLimiter.check(`rfq:${ws.activeOrgId}`)).ok) {
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

  const products = await prisma.product.findMany({
    where: {
      id: { in: basket.map((b) => b.productId) },
      active: true,
      bookable: true,
    },
    include: {
      priceRules: true,
      title: { include: { publisher: true, market: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = basket.filter((b) => byId.has(b.productId));
  if (items.length === 0) redirect(`/${locale}/plan?error=1`);

  // Multi-currency split: one Quote per placement market. A cross-
  // border basket (e.g. NO + SE + DE) becomes one Request with three
  // Quotes, each in its market's currency and VAT. Grouping by market
  // (not currency) keeps the four EUR markets — DE/AT/IE/FI — apart
  // since they all share EUR but have different VAT rates.
  const groups = groupItemsByMarket(items, byId);
  // For the legacy Plan.currency field: a single-market basket keeps
  // the single currency; multi-market basket leaves it null, signalling
  // that the per-Quote currencies are the source of truth.
  const planCurrency = groups.length === 1 ? groups[0].currency : null;

  // Self-serve: an all-firm-priced basket needs no desk — auto-quote,
  // auto-accept and confirm the order immediately. Server-side gate
  // mirrors the plan page UI: any line whose title has hidden prices
  // OR whose price hasn't been confirmed yet forces the basket onto
  // the RFQ path so we never auto-charge a buyer against a price
  // they couldn't see in the catalog.
  const allFirm = items.every((i) => {
    const product = byId.get(i.productId);
    if (!product) return false;
    if (product.visibility !== "FIRM") return false;
    return isProductPriceShown(product, product.title);
  });

  // Commit gate: the all-firm path creates a CONFIRMED order immediately —
  // the same commitment as acceptQuote/acceptAllQuotesForRequest. Only
  // members (or agencies) with canCommit authority may proceed. The RFQ
  // path (allFirm === false) is NOT a commit and must stay ungated so any
  // member can request a quote from the desk.
  if (allFirm) {
    const scope = await loadScope();
    if (!canCommitOnOrg(scope, org.id)) {
      redirect(`/${locale}/plan?error=forbidden`);
    }
  }

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

  // Content-production fees only matter on the self-serve (allFirm) path,
  // which mints quotes here; the RFQ path defers pricing to the desk.
  const feeRules = allFirm ? await loadContentFeeRules() : [];

  const request = await prisma.$transaction(async (tx) => {
    const plan = await tx.plan.create({
      data: {
        organizationId: org.id,
        name: `${org.name} — campaign`,
        budget: budgetRaw ? Number(budgetRaw) || null : null,
        currency: planCurrency,
        goal: goal || null,
        audienceNote: audience || null,
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            withContent: i.withContent ?? false,
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
      for (const group of groups) {
        const lines = [
          ...computeQuoteLines(
            group.items.map((i) =>
              toQuotable(byId.get(i.productId)!, i.quantity),
            ),
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
            requestId: req.id,
            status: "ACCEPTED",
            currency: group.currency,
            subtotal,
            vatPct: group.vatPct,
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
                kind: l.kind,
                productId: l.productId,
                quantity: l.quantity,
                lineTotal: l.lineTotal,
              })),
            },
          },
          include: { lines: true },
        });
        // Briefs and publisher bookings attach only to inventory lines —
        // a CONTENT_FEE line is a billing line for production work that
        // is briefed/fulfilled against the placement line itself.
        const placementLines = order.lines.filter((l) => l.kind === "INVENTORY");
        await tx.contentBrief.createMany({
          data: placementLines.map((l) => ({
            orderLineId: l.id,
            message: goal || null,
            audience: audience || null,
          })),
        });
        await tx.publisherBooking.createMany({
          data: placementLines.map((l) => ({ orderLineId: l.id })),
        });
      }
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
  store.delete(PLAN_BRIEF_COOKIE);
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

// "Use as template" — rehydrate the in-flight basket cookie from a past
// Plan tied to an Order. Closes Maja R2's gap: returning customers
// who want to repeat what worked shouldn't rebuild the basket title
// by title. The new in-flight plan is editable in /plan before the
// buyer re-submits the RFQ.
//
// Authorisation: the order's organisation must be in the caller's
// scope (own org or, for agencies, the selected client). Anything
// else gets a redirect — no leaking of basket structure across orgs.
//
// Products that have been deactivated since the original order are
// dropped from the rehydrated basket; the buyer sees a count message
// at /plan and can find substitutes via the catalog.
export async function duplicatePlan(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const orderId = str(formData, "orderId");

  const scope = await loadScope();
  if (!scope.userId) {
    redirect(`/${locale}/signin`);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      organizationId: true,
      quote: {
        select: {
          request: {
            select: {
              plan: {
                select: {
                  id: true,
                  items: {
                    select: { productId: true, quantity: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) {
    redirect(`/${locale}/orders`);
  }
  if (!canActOnOrg(scope, order.organizationId)) {
    redirect(`/${locale}/orders`);
  }

  const sourceItems = order.quote.request.plan.items;
  if (sourceItems.length === 0) {
    redirect(`/${locale}/plan?duplicate=empty`);
  }

  // Drop products that have been deactivated since the original order
  // ran. The buyer is told how many items survived so they don't
  // discover the loss after submitting.
  const stillActive = await prisma.product.findMany({
    where: {
      id: { in: sourceItems.map((i) => i.productId) },
      active: true,
      bookable: true,
    },
    select: { id: true },
  });
  const activeIds = new Set(stillActive.map((p) => p.id));
  const items: BasketItem[] = sourceItems
    .filter((i) => activeIds.has(i.productId))
    .map((i) => ({ productId: i.productId, quantity: i.quantity }));

  await writeBasket(items);
  await recordAudit(
    scope.userId,
    "plan.duplicate",
    `Order:${orderId}`,
    {
      sourcePlanId: order.quote.request.plan.id,
      restored: items.length,
      dropped: sourceItems.length - items.length,
    },
  );

  const dropped = sourceItems.length - items.length;
  redirect(
    `/${locale}/plan?duplicate=` +
      (items.length === 0
        ? "all-inactive"
        : dropped > 0
          ? `partial-${dropped}`
          : "ok"),
  );
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
  if (!canCommitOnOrg(scope, quote.request.organizationId)) {
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
            kind: l.kind,
            productId: l.productId,
            quantity: l.quantity,
            lineTotal: l.lineTotal,
          })),
        },
      },
      include: { lines: true },
    });

    // Briefs and bookings attach to placement lines only — CONTENT_FEE
    // lines are billing-only.
    const placementLines = order.lines.filter((l) => l.kind === "INVENTORY");
    await tx.contentBrief.createMany({
      data: placementLines.map((line) => ({
        orderLineId: line.id,
        message: plan.goal,
        audience: plan.audienceNote,
      })),
    });
    await tx.publisherBooking.createMany({
      data: placementLines.map((line) => ({ orderLineId: line.id })),
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
  const pubIds = await uniquePublisherIdsForProducts(
    quote.lines.map((l) => l.productId).filter((id): id is string => !!id),
  );
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
      plan: true,
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

  const plan = request.plan;
  const createdOrders = await prisma.$transaction(async (tx) => {
    const orders: { id: string; productIds: string[] }[] = [];
    for (const quote of openQuotes) {
      const order = await tx.order.create({
        data: {
          organizationId: request.organizationId,
          quoteId: quote.id,
          status: "CONFIRMED",
          lines: {
            create: quote.lines.map((l) => ({
              kind: l.kind,
              productId: l.productId,
              quantity: l.quantity,
              lineTotal: l.lineTotal,
            })),
          },
        },
        include: { lines: true },
      });
      const placementLines = order.lines.filter((l) => l.kind === "INVENTORY");
      await tx.contentBrief.createMany({
        data: placementLines.map((line) => ({
          orderLineId: line.id,
          message: plan.goal,
          audience: plan.audienceNote,
        })),
      });
      await tx.publisherBooking.createMany({
        data: placementLines.map((line) => ({ orderLineId: line.id })),
      });
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: "ACCEPTED" },
      });
      orders.push({
        id: order.id,
        productIds: quote.lines
          .map((l) => l.productId)
          .filter((id): id is string => !!id),
      });
    }
    await tx.request.update({
      where: { id: request.id },
      data: { status: "CLOSED" },
    });
    return orders;
  });

  for (const o of createdOrders) {
    await recordAudit(scope.userId, "quote.accept", `Order:${o.id}`, {
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
