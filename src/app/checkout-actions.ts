"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireOnboardingBeforeBuy } from "@/lib/onboarding-gate";
import { getWorkspace } from "@/lib/workspace";
import { readActiveListId, ensureActiveListId, loadListWithItems, committedItems } from "@/lib/lists";
import { alignActivePlan, refusalNotice, resolvePlanTarget } from "@/lib/plan-target";
import { planPath } from "@/lib/plan-path";
import { saveListBrief } from "@/lib/plan-brief";
import { isInstantOrderable } from "@/lib/pricing/visibility";
import { withWaveAngle } from "@/lib/programme";
import {
  createFirmOrder,
  FirmOrderStaleError,
  FirmOrderChangedError,
  fingerprintListItems,
  type FirmOrderResult,
} from "@/lib/commerce/firm-order";
import { submitListAsRfq } from "@/lib/commerce/submit-rfq";
import { liveOrderForList } from "@/lib/commerce/list-commit";
import { planNameFor } from "@/lib/plan-name";
import { uniquePublisherIdsForProducts } from "@/lib/commerce/publishers";
import { groupItemsByMarket } from "@/lib/quote-grouping";
import { recordAudit } from "@/lib/audit";
import { notifyOrg, notifyPublisher } from "@/lib/notify";
import { isAudienceSegment } from "@/lib/targeting/segments";
import { rfqLimiter } from "@/lib/rate-limit";
import { loadScope, canCommitOnOrg } from "@/lib/scope";
import { clientIp } from "@/lib/client-ip";
import { listNames } from "@/lib/list-names";

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
  if (!ws) redirect(`/${locale}/signin`);

  // Submit the plan the page shows: /plan/<listId> posts its listId. Never the
  // active-list cookie — that names the plan opened last in ANY tab, so a
  // "Send" in the tab showing plan A would submit plan B (lib/plan-target.ts).
  // A form without a listId (rendered before this field existed) keeps the old
  // cookie behaviour for the active org.
  const postedListId = str(formData, "listId");
  let listId: string;
  let orgId: string;
  if (postedListId) {
    const target = await resolvePlanTarget(ws, postedListId);
    if (!target.ok) {
      console.warn("checkout.blocked", { reason: `list-${target.reason}`, userId: ws.userId, listId: postedListId });
      redirect(planPath(locale, null, refusalNotice(target)));
    }
    listId = target.list.id;
    orgId = target.list.organizationId;
    // Every redirect below lands on this plan's own address; making it the
    // active plan first means /plan/<listId> renders without a detour.
    await alignActivePlan(ws, target.list);
  } else {
    if (!ws.activeOrgId) redirect(ws.isAgency ? `/${locale}/agency` : `/${locale}/signin`);
    // Sending a plan to the desk is a write: never for a view-only seat
    // (the posted-listId path gets the same answer from resolvePlanTarget).
    if (!ws.editOrgIds.includes(ws.activeOrgId)) {
      console.warn("checkout.blocked", { reason: "list-read-only", userId: ws.userId });
      redirect(planPath(locale, null, { notice: "plan-read-only" }));
    }
    orgId = ws.activeOrgId;
    listId = await ensureActiveListId(orgId, await readActiveListId(), undefined, (await listNames(locale)).untitled);
  }
  const back = (error?: string) => planPath(locale, listId, error ? { error } : undefined);

  // An ordered plan is spent (lib/commerce/list-commit.ts): /plan shows
  // "Ordered" instead of the button, but a page left open — or a second tab —
  // can still post. Neither path may commit it again: land on the order that
  // exists. Booking the same lines again is a new plan ("Plan next wave").
  const ordered = await liveOrderForList(prisma, listId);
  if (ordered) {
    console.warn("checkout.blocked", { reason: "already-ordered", userId: ws.userId, listId });
    redirect(`/${locale}/requests/${ordered.requestId}?notice=already-ordered`);
  }

  // The brief belongs to the plan: persist what was typed before anything can
  // bounce the buyer (onboarding, a refused submit), so it's still there when
  // they come back, and a programme's later waves inherit it.
  await saveListBrief(listId, {
    // A form rendered before briefText existed only posts the composed brief.
    briefText: formData.has("briefText") ? str(formData, "briefText") : brief,
    briefTiming: str(formData, "briefTiming"),
    budget: budgetRaw,
    budgetCurrency: str(formData, "budgetCurrency"),
    targetAudience,
    targetGeo,
    targetContext,
  });

  // Buyer onboarding is deferred to the moment of buying intent: the
  // desk needs a reachable phone number, and the billing market drives
  // VAT + invoice currency on the Quote we're about to mint. Bounces
  // to /onboarding?next=/plan/<listId> so the user lands back on this plan
  // with the brief intact after filling in the two fields.
  await requireOnboardingBeforeBuy(session, locale, back(), orgId);

  if (!(await rfqLimiter.check(`rfq:${orgId}`)).ok) {
    console.warn("checkout.blocked", { reason: "rate", orgId });
    redirect(back("rate"));
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
  });
  if (!org) {
    redirect(`/${locale}/signin`);
  }

  // The saved list is the durable replacement for the basket cookie. It can
  // hold product lines (productId set) and Title placeholders (titleId set,
  // productId null). The list is NOT consumed on submit.
  const list = await loadListWithItems(listId);
  if (!list) redirect(planPath(locale, null, { notice: "plan-unavailable" }));
  // Recommended alternatives are never part of a submit or an order.
  const planItems = committedItems(list.items);
  if (planItems.length === 0) redirect(back("empty"));

  // A wave of a programme carries its own article angle — put it at the top
  // of the desk-facing brief so the desk and the writer start from THIS
  // wave's idea, not a rerun of the last one. The buyer's own text is kept
  // verbatim below it (and stays untouched in the plan's saved brief). The
  // list's own include (lists.ts) doesn't hydrate the article relation, so
  // it's fetched here — nested, to match RfqSourceList's shape below.
  const article = list.articleId
    ? await prisma.article.findUnique({ where: { id: list.articleId }, select: { title: true } })
    : null;
  const deskBrief = await withWaveAngle(brief, { ...list, articleTitle: article?.title ?? null });

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
  const deactivatedLines = planItems.filter(
    (i) => i.productId && (!i.product || !i.product.active || !i.product.bookable),
  );
  if (deactivatedLines.length > 0) {
    console.warn("checkout.blocked", { reason: "unavailable", orgId: org.id, lines: deactivatedLines.length });
    redirect(back("unavailable"));
  }

  const productItems = planItems.filter(
    (i): i is typeof i & { productId: string; product: NonNullable<typeof i.product> } =>
      !!i.productId && !!i.product && i.product.active && i.product.bookable,
  );
  const titleItems = planItems.filter((i) => !i.productId && i.titleId);
  if (productItems.length === 0 && titleItems.length === 0) {
    redirect(back("empty"));
  }

  // Fingerprint the item set at load; re-checked just before we write (below) so
  // a concurrent edit from another agency seat / second tab can't make us
  // snapshot — or instant-charge — a stale list (line removed/added/qty changed
  // during the grouping + gate round-trips).
  // withContent is included because it drives CONTENT_FEE charges on the firm
  // (instant-order) path — a concurrent toggle must invalidate the snapshot too.
  // (Definition shared with createFirmOrder's in-transaction guard.)
  const loadedFingerprint = fingerprintListItems(planItems);

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
  //
  // mode=rfq: the buyer explicitly asked for a quote instead. /plan offers it
  // to a member without ordering rights on an all-firm plan, so they can send
  // it for the desk to quote and an admin to accept, rather than hit the
  // commit gate below. It can only ever move a submit OFF the instant path.
  const rfqRequested = str(formData, "mode") === "rfq";
  const allFirm =
    !rfqRequested &&
    titleItems.length === 0 &&
    items.length > 0 &&
    items.every((i) => {
      const product = byId.get(i.productId);
      return !!product && isInstantOrderable(product, product.title);
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
      redirect(back("forbidden"));
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
      redirect(back("availability"));
    }
  }

  // Abort if the list changed since we loaded it (see fingerprint above) — the
  // buyer reviews the refreshed list and resubmits rather than us committing a
  // stale snapshot / charging for a line they just removed.
  const freshItems = await prisma.savedListItem.findMany({
    where: { listId: list.id, isAlternative: false },
    select: { id: true, quantity: true, productId: true, titleId: true, withContent: true },
  });
  if (fingerprintListItems(freshItems) !== loadedFingerprint) {
    console.warn("checkout.blocked", { reason: "changed", orgId: org.id, listId: list.id });
    redirect(back("changed"));
  }

  let request: { id: string };
  // The instant path's orders (one per placement market), for its buyer
  // confirmation; the RFQ path has none yet.
  let firmOrderIds: string[] = [];
  const planName = planNameFor({ listName: list.name, orgName: org.name, locale });
  if (allFirm) {
    // Self-serve: hand the cleared FIRM basket to the shared order factory
    // — the single source of truth the POST /api/v1/orders endpoint also
    // uses. It mints the plan, an auto-accepted quote per market, and a
    // CONFIRMED order with briefs + publisher bookings.
    let result: FirmOrderResult;
    try {
      result = await createFirmOrder({
        organizationId: org.id,
        orgName: org.name,
        planName,
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
        redirect(back("unavailable"));
      }
      // The list was edited (another seat/tab) after our pre-flight fingerprint
      // check — same buyer outcome as the pre-flight catch: review & resubmit.
      if (e instanceof FirmOrderChangedError) {
        console.warn("checkout.blocked", { reason: "changed", orgId: org.id, via: "firmOrderChanged", listId: list.id });
        redirect(back("changed"));
      }
      throw e;
    }
    // Another click (double submit, second tab) ordered this plan while this
    // one waited on the order lock: nothing new was booked, so nothing to
    // announce — show the buyer the order that exists.
    if (result.alreadyOrdered) redirect(`/${locale}/requests/${result.requestId}?notice=already-ordered`);
    request = { id: result.requestId };
    firmOrderIds = result.orderIds;
  } else {
    // RFQ: extracted to the lib so the programme auto-send sweep can submit
    // a due wave through the exact same path (plan snapshot, flight window,
    // wave-angle brief, request, audit, desk notification). The shared
    // pre-checks above (idempotency, deactivated lines, emptiness) normally
    // guarantee "submitted"; the lib re-runs them, so a race between those
    // checks and this write still resolves to the same redirects.
    const rfq = await submitListAsRfq({
      list: { ...list, article },
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
    if (rfq.outcome === "unavailable") redirect(back("unavailable"));
    if (rfq.outcome === "empty") redirect(back("empty"));
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
    // The same confirmation an accepted quote sends (quote-lifecycle.ts).
    await notifyOrg(org.id, {
      kind: "QUOTE_ACCEPTED",
      template: {
        key: "orderConfirmed",
        params: {
          planName,
          requestId: request.id,
          orderId: firmOrderIds.length === 1 ? firmOrderIds[0] : null,
        },
      },
    });
    const pubIds = await uniquePublisherIdsForProducts(items.map((i) => i.productId));
    await Promise.all(
      pubIds.map((pid) =>
        notifyPublisher(pid, {
          kind: "BOOKING_NEW",
          template: { key: "bookingNew", params: { orgName: org.name, via: "instant" } },
        }),
      ),
    );
  }

  // The active saved list is durable — nothing to clear on submit.
  redirect(`/${locale}/requests/${request.id}`);
}
