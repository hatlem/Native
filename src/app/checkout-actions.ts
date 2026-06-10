"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireOnboardingBeforeBuy } from "@/lib/onboarding-gate";
import { getWorkspace } from "@/lib/workspace";
import {
  PLAN_COOKIE,
  PLAN_BRIEF_COOKIE,
  planBriefHasContent,
  readBasket,
  writePlanBrief,
} from "@/lib/basket";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { createFirmOrder } from "@/lib/commerce/firm-order";
import { uniquePublisherIdsForProducts } from "@/lib/commerce/publishers";
import { authorshipFromWithContent } from "@/lib/authorship";
import { groupItemsByMarket } from "@/lib/quote-grouping";
import { recordAudit } from "@/lib/audit";
import { notifyDesk, notifyOrg, notifyPublisher } from "@/lib/notify";
import { isAudienceSegment } from "@/lib/targeting/segments";
import { rfqLimiter } from "@/lib/rate-limit";
import { loadScope, canCommitOnOrg } from "@/lib/scope";
import { clientIp } from "@/lib/client-ip";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function submitRequest(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const budgetRaw = str(formData, "budget");
  const goal = str(formData, "goal");
  const audience = str(formData, "audience");
  const brief = str(formData, "brief");
  const targetGeo = str(formData, "targetGeo");
  const targetContext = str(formData, "targetContext");
  // Audience segments are a checkbox group → collect all checked values,
  // keep only known segment keys (defends against tampered form posts).
  const targetAudience = formData
    .getAll("targetAudience")
    .map((v) => String(v))
    .filter(isAudienceSegment)
    .join(",");

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
    targetGeo,
    targetAudience,
    targetContext,
  };
  if (planBriefHasContent(briefDraft)) {
    await writePlanBrief(briefDraft);
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

  let request: { id: string };
  if (allFirm) {
    // Self-serve: hand the cleared FIRM basket to the shared order factory
    // — the single source of truth the POST /api/v1/orders endpoint also
    // uses. It mints the plan, an auto-accepted quote per market, and a
    // CONFIRMED order with briefs + publisher bookings.
    const result = await createFirmOrder({
      organizationId: org.id,
      orgName: org.name,
      items,
      byId,
      brief: {
        briefText: brief,
        goal: goal || null,
        audience: audience || null,
        budget: budgetRaw ? Number(budgetRaw) || null : null,
        currency: planCurrency,
        targetGeo: targetGeo || null,
        targetAudience: targetAudience || null,
        targetContext: targetContext || null,
      },
    });
    request = { id: result.requestId };
  } else {
    // RFQ: create the plan + request for the desk to price later. No
    // quotes here — pricing is deferred to generateQuote.
    request = await prisma.$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          organizationId: org.id,
          name: `${org.name} — campaign`,
          budget: budgetRaw ? Number(budgetRaw) || null : null,
          currency: planCurrency,
          goal: goal || null,
          audienceNote: audience || null,
          targetGeo: targetGeo || null,
          targetAudience: targetAudience || null,
          targetContext: targetContext || null,
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              withContent: i.withContent ?? false,
              authorshipMode: authorshipFromWithContent(i.withContent),
            })),
          },
        },
      });

      // Fold structured targeting intent into the desk-facing brief so the
      // desk sees it as readable lines, not just buried Plan columns.
      const targetingLines = [
        targetGeo && `Geo: ${targetGeo}`,
        targetAudience && `Audience: ${targetAudience}`,
        targetContext && `Context: ${targetContext}`,
      ].filter(Boolean);
      const briefSummary =
        [brief, ...targetingLines].filter(Boolean).join("\n") || null;

      const req = await tx.request.create({
        data: {
          organizationId: org.id,
          planId: plan.id,
          status: "SUBMITTED",
          briefSummary,
        },
      });
      return { id: req.id };
    });
  }

  await recordAudit(session?.user?.id ?? null, "request.submit", `Request:${request.id}`, {
    orgId: org.id,
    allFirm,
    ip: await clientIp(),
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
