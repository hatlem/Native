"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireOnboardingBeforeBuy } from "@/lib/onboarding-gate";
import { getWorkspace } from "@/lib/workspace";
import {
  planBriefHasContent,
  writePlanBrief,
} from "@/lib/basket";
import { readActiveListId, ensureActiveList } from "@/lib/lists";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { withWaveAngle } from "@/lib/programme";
import {
  createFirmOrder,
  FirmOrderStaleError,
  FirmOrderChangedError,
  fingerprintListItems,
} from "@/lib/commerce/firm-order";
import { submitListAsRfq } from "@/lib/commerce/submit-rfq";
import { uniquePublisherIdsForProducts } from "@/lib/commerce/publishers";
import { groupItemsByMarket } from "@/lib/quote-grouping";
import { recordAudit } from "@/lib/audit";
import { notifyOrg, notifyPublisher } from "@/lib/notify";
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
    console.warn("checkout.blocked", { reason: "rate", orgId: ws.activeOrgId });
    redirect(`/${locale}/plan?error=rate`);
  }

  const org = await prisma.organization.findUnique({
    where: { id: ws.activeOrgId },
  });
  if (!org) {
    redirect(`/${locale}/signin`);
  }

  // Submit the active saved list — the durable replacement for the basket
  // cookie. It can hold product lines (productId set) and Title placeholders
  // (titleId set, productId null). The list is NOT consumed on submit.
  const list = await ensureActiveList(org.id, await readActiveListId());
  if (list.items.length === 0) redirect(`/${locale}/plan?error=1`);

  // A wave of a programme carries its own article angle — put it at the top
  // of the desk-facing brief so the desk and the writer start from THIS
  // wave's idea, not a rerun of the last one. The buyer's own text is kept
  // verbatim below it (and stays untouched in the cookie draft).
  const deskBrief = await withWaveAngle(brief, list);

  // Idempotency: a network-retried / double-clicked submit of the SAME list
  // within a short window must not mint a second Request (and, on the firm
  // path, a second CONFIRMED+charged order). Redirect the retry to the
  // request the first submit just created.
  const recent = await prisma.request.findFirst({
    where: {
      sourceListId: list.id,
      organizationId: org.id,
      createdAt: { gt: new Date(Date.now() - 10_000) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (recent) redirect(`/${locale}/requests/${recent.id}`);

  // A product deactivated AFTER it was added still renders on /plan (the page
  // only hides its price). Refuse to submit a list that would silently amputate
  // it — don't drop a line the buyer can still see. They must remove it first.
  const deactivatedLines = list.items.filter(
    (i) => i.productId && (!i.product || !i.product.active || !i.product.bookable),
  );
  if (deactivatedLines.length > 0) {
    console.warn("checkout.blocked", { reason: "unavailable", orgId: org.id, lines: deactivatedLines.length });
    redirect(`/${locale}/plan?error=unavailable`);
  }

  const productItems = list.items.filter(
    (i): i is typeof i & { productId: string; product: NonNullable<typeof i.product> } =>
      !!i.productId && !!i.product && i.product.active && i.product.bookable,
  );
  const titleItems = list.items.filter((i) => !i.productId && i.titleId);
  if (productItems.length === 0 && titleItems.length === 0) {
    redirect(`/${locale}/plan?error=1`);
  }

  // Fingerprint the item set at load; re-checked just before we write (below) so
  // a concurrent edit from another agency seat / second tab can't make us
  // snapshot — or instant-charge — a stale list (line removed/added/qty changed
  // during the grouping + gate round-trips).
  // withContent is included because it drives CONTENT_FEE charges on the firm
  // (instant-order) path — a concurrent toggle must invalidate the snapshot too.
  // (Definition shared with createFirmOrder's in-transaction guard.)
  const loadedFingerprint = fingerprintListItems(list.items);

  // Shape the downstream code already expects (groupItemsByMarket, allFirm,
  // createFirmOrder). Title-only lines never enter `items`/`byId`.
  const items = productItems.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    withContent: i.withContent,
    scheduleStart: i.scheduleStart,
    scheduleUnits: i.scheduleUnits,
  }));
  const byId = new Map(productItems.map((i) => [i.productId, i.product]));

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
  // Any unresolved Title placeholder cannot be auto-priced, so its presence
  // forces the desk RFQ path (never the instant all-firm order).
  const allFirm =
    titleItems.length === 0 &&
    items.length > 0 &&
    items.every((i) => {
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
      console.warn("checkout.blocked", { reason: "forbidden", orgId: org.id });
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
    if (blocked) {
      console.warn("checkout.blocked", { reason: "availability", orgId: org.id, productId: blocked.productId });
      redirect(`/${locale}/plan?error=availability`);
    }
  }

  // Abort if the list changed since we loaded it (see fingerprint above) — the
  // buyer reviews the refreshed list and resubmits rather than us committing a
  // stale snapshot / charging for a line they just removed.
  const freshItems = await prisma.savedListItem.findMany({
    where: { listId: list.id },
    select: { id: true, quantity: true, productId: true, titleId: true, withContent: true },
  });
  if (fingerprintListItems(freshItems) !== loadedFingerprint) {
    console.warn("checkout.blocked", { reason: "changed", orgId: org.id, listId: list.id });
    redirect(`/${locale}/plan?error=changed`);
  }

  let request: { id: string };
  if (allFirm) {
    // Self-serve: hand the cleared FIRM basket to the shared order factory
    // — the single source of truth the POST /api/v1/orders endpoint also
    // uses. It mints the plan, an auto-accepted quote per market, and a
    // CONFIRMED order with briefs + publisher bookings.
    let result: { requestId: string; orderIds: string[] };
    try {
      result = await createFirmOrder({
        organizationId: org.id,
        orgName: org.name,
        items,
        byId,
        listGuard: { listId: list.id, fingerprint: loadedFingerprint },
        sourceListId: list.id,
        brief: {
          briefText: deskBrief,
          goal: goal || null,
          audience: audience || null,
          budget: budgetRaw ? Number(budgetRaw) || null : null,
          currency: planCurrency,
          targetGeo: targetGeo || null,
          targetAudience: targetAudience || null,
          targetContext: targetContext || null,
        },
      });
    } catch (e) {
      // A product went unavailable between load and the committing transaction —
      // bounce the buyer to review rather than instant-charge a stale basket.
      if (e instanceof FirmOrderStaleError) {
        console.warn("checkout.blocked", { reason: "unavailable", orgId: org.id, via: "firmOrderStale", listId: list.id });
        redirect(`/${locale}/plan?error=unavailable`);
      }
      // The list was edited (another seat/tab) after our pre-flight fingerprint
      // check — same buyer outcome as the pre-flight catch: review & resubmit.
      if (e instanceof FirmOrderChangedError) {
        console.warn("checkout.blocked", { reason: "changed", orgId: org.id, via: "firmOrderChanged", listId: list.id });
        redirect(`/${locale}/plan?error=changed`);
      }
      throw e;
    }
    request = { id: result.requestId };
  } else {
    // RFQ: extracted to the lib so the programme auto-send sweep can submit
    // a due wave through the exact same path (plan snapshot, flight window,
    // wave-angle brief, request, audit, desk notification). The shared
    // pre-checks above (idempotency, deactivated lines, emptiness) normally
    // guarantee "submitted"; the lib re-runs them, so a race between those
    // checks and this write still resolves to the same redirects.
    const rfq = await submitListAsRfq({
      list,
      org: { id: org.id, name: org.name },
      brief: {
        text: brief,
        goal: goal || null,
        audience: audience || null,
        budget: budgetRaw ? Number(budgetRaw) || null : null,
        targetGeo: targetGeo || null,
        targetAudience: targetAudience || null,
        targetContext: targetContext || null,
      },
      actorUserId: session?.user?.id ?? null,
      locale,
      auditIp: await clientIp(),
    });
    if (rfq.outcome === "duplicate") redirect(`/${locale}/requests/${rfq.requestId}`);
    if (rfq.outcome === "unavailable") redirect(`/${locale}/plan?error=unavailable`);
    if (rfq.outcome === "empty") redirect(`/${locale}/plan?error=1`);
    request = { id: rfq.requestId };
  }

  if (allFirm) {
    // The RFQ branch audits inside submitListAsRfq; the firm branch keeps
    // its audit row here, same fields as before.
    await recordAudit(session?.user?.id ?? null, "request.submit", `Request:${request.id}`, {
      orgId: org.id,
      allFirm,
      ip: await clientIp(),
    });
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
  }

  // The active saved list is durable — nothing to clear on submit.
  redirect(`/${locale}/requests/${request.id}`);
}
