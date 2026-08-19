// The RFQ submit path, extracted from the submitRequest server action so it
// can run without a session: the checkout action calls it for any non-firm
// basket, and the programme auto-send sweep (programme-autosend.ts) calls it
// to submit a due wave. Behaviour is a faithful move of the action's RFQ
// branch — snapshot to a Plan, derive the flight window, prefix the wave
// angle, mint the Request, audit, and notify the desk. The FIRM instant-order
// path lives in firm-order.ts and is untouched by this module.
//
// Auth, onboarding gates, rate limiting, cookies and redirects stay in the
// server action — this module is pure domain logic plus DB, so it is testable
// (see programme.it.test.ts) and callable from background jobs.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { snapshotListToPlanData } from "@/lib/lists";
import { planWindowFromItems, type BookingUnit } from "@/lib/campaign-schedule";
import { withWaveAngle } from "@/lib/programme";
import { groupItemsByMarket, type QuoteGroupingProduct } from "@/lib/quote-grouping";
import { recordAudit } from "@/lib/audit";
import { notifyDesk } from "@/lib/notify";
import type { AuthorshipMode } from "@/lib/authorship";

/** What a list item must carry to be submitted — the checkout action's
 *  ActiveList items are a structural superset of this. */
export type RfqListItem = {
  productId: string | null;
  titleId: string | null;
  quantity: number;
  withContent: boolean;
  authorshipMode: AuthorshipMode;
  scheduleStart: Date | null;
  scheduleUnits: number | null;
  notes: string | null;
  product:
    | ({ active: boolean; bookable: boolean; bookingUnit: BookingUnit } & QuoteGroupingProduct)
    | null;
};

export type RfqSourceList = {
  id: string;
  organizationId: string;
  // Wave membership — withWaveAngle prefixes the desk brief for waves and
  // passes plain lists through unchanged.
  programmeId: string | null;
  waveNumber: number | null;
  articleAngle: string | null;
  items: RfqListItem[];
};

/** Everything the buyer typed into the brief panel; the auto-send sweep fills
 *  it from the SavedList's stored fields instead. */
export type RfqBrief = {
  text: string;
  goal: string | null;
  audience: string | null;
  budget: number | null;
  targetGeo: string | null;
  targetAudience: string | null;
  targetContext: string | null;
};

export type SubmitRfqResult =
  // A Request was minted; the caller navigates/links to it.
  | { outcome: "submitted"; requestId: string }
  // A submit of the SAME list landed within the idempotency window — the
  // caller treats the earlier Request as the result (redirect, not error).
  | { outcome: "duplicate"; requestId: string }
  // A visible line's product was deactivated after it was added — refuse
  // rather than silently amputate it (the buyer must remove it first).
  | { outcome: "unavailable" }
  // Nothing submittable on the list.
  | { outcome: "empty" };

/** Prisma include that hydrates a SavedList into an RfqSourceList — used by
 *  callers (the auto-send sweep) that don't already hold a loaded list. */
export const RFQ_LIST_INCLUDE = {
  items: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      product: {
        select: {
          id: true,
          active: true,
          bookable: true,
          bookingUnit: true,
          title: {
            select: {
              marketId: true,
              market: { select: { code: true, currency: true, vatRatePct: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.SavedListInclude;

export async function submitListAsRfq(input: {
  list: RfqSourceList;
  org: { id: string; name: string };
  brief: RfqBrief;
  // Who to attribute the audit row to; null = system (auto-send sweep).
  actorUserId: string | null;
  // Locale for the desk notification link; defaults to "en" for callers
  // without a request locale (the sweep).
  locale?: string;
  // Best-effort client IP for the audit row; server actions pass it, the
  // sweep has none so the key is simply omitted.
  auditIp?: string;
}): Promise<SubmitRfqResult> {
  const { list, org, brief } = input;
  const locale = input.locale ?? "en";

  // A wave of a programme carries its own article angle — put it at the top
  // of the desk-facing brief so the desk and the writer start from THIS
  // wave's idea, not a rerun of the last one. The buyer's own text is kept
  // verbatim below it.
  const deskBrief = await withWaveAngle(brief.text, list);

  // Idempotency: a network-retried / double-clicked submit of the SAME list
  // within a short window must not mint a second Request. The caller resolves
  // the retry to the request the first submit just created.
  const recent = await prisma.request.findFirst({
    where: {
      sourceListId: list.id,
      organizationId: org.id,
      createdAt: { gt: new Date(Date.now() - 10_000) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (recent) return { outcome: "duplicate", requestId: recent.id };

  // A product deactivated AFTER it was added still renders on /plan (the page
  // only hides its price). Refuse to submit a list that would silently amputate
  // it — don't drop a line the buyer can still see. They must remove it first.
  const deactivatedLines = list.items.filter(
    (i) => i.productId && (!i.product || !i.product.active || !i.product.bookable),
  );
  if (deactivatedLines.length > 0) {
    console.warn("rfq.blocked", { reason: "unavailable", orgId: org.id, lines: deactivatedLines.length });
    return { outcome: "unavailable" };
  }

  const productItems = list.items.filter(
    (i): i is RfqListItem & { productId: string; product: NonNullable<RfqListItem["product"]> } =>
      !!i.productId && !!i.product && i.product.active && i.product.bookable,
  );
  const titleItems = list.items.filter((i) => !i.productId && i.titleId);
  if (productItems.length === 0 && titleItems.length === 0) {
    return { outcome: "empty" };
  }

  // For the legacy Plan.currency field: a single-market basket keeps the
  // single currency; a multi-market basket leaves it null, signalling that
  // the per-Quote currencies are the source of truth. Grouping is by market
  // (not currency) — see quote-grouping.ts for the Eurozone/VAT rationale.
  const byId = new Map(productItems.map((i) => [i.productId, i.product]));
  const groups = groupItemsByMarket(
    productItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    byId,
  );
  const planCurrency = groups.length === 1 ? groups[0].currency : null;

  // RFQ: create the plan + request for the desk to price later. No quotes
  // here — pricing is deferred to generateQuote.
  const request = await prisma.$transaction(async (tx) => {
    // Snapshot BOTH product lines and Title placeholders into the Plan so
    // the desk sees the full ask — title-only lines land as
    // PlanItem{titleId, productId:null} for the desk to resolve manually.
    const planItems = snapshotListToPlanData([
      ...productItems.map((i) => ({
        productId: i.productId,
        titleId: null,
        quantity: i.quantity,
        withContent: i.withContent,
        authorshipMode: i.authorshipMode,
        scheduleStart: i.scheduleStart,
        scheduleUnits: i.scheduleUnits,
        notes: i.notes,
      })),
      ...titleItems.map((i) => ({
        productId: null,
        titleId: i.titleId,
        quantity: i.quantity,
        withContent: i.withContent,
        authorshipMode: i.authorshipMode,
        scheduleStart: i.scheduleStart,
        scheduleUnits: i.scheduleUnits,
        notes: i.notes,
      })),
    ]);
    // The buyer's per-line schedule → the plan's flight window → (on
    // acceptance) Order.flightStart/EndDate. Placeholder lines have no
    // product yet, so their unit is unknown; MONTH is the catalog default.
    const flight = planWindowFromItems(
      list.items.map((i) => ({
        scheduleStart: i.scheduleStart,
        scheduleUnits: i.scheduleUnits,
        bookingUnit: i.product?.bookingUnit ?? "MONTH",
      })),
    );
    const plan = await tx.plan.create({
      data: {
        organizationId: org.id,
        name: `${org.name} — campaign`,
        budget: brief.budget,
        currency: planCurrency,
        startDate: flight.start,
        endDate: flight.end,
        goal: brief.goal,
        audienceNote: brief.audience,
        targetGeo: brief.targetGeo,
        targetAudience: brief.targetAudience,
        targetContext: brief.targetContext,
        items: {
          create: planItems,
        },
      },
    });

    // Fold structured targeting intent into the desk-facing brief so the
    // desk sees it as readable lines, not just buried Plan columns.
    const targetingLines = [
      brief.targetGeo && `Geo: ${brief.targetGeo}`,
      brief.targetAudience && `Audience: ${brief.targetAudience}`,
      brief.targetContext && `Context: ${brief.targetContext}`,
    ].filter(Boolean);
    const briefSummary =
      [deskBrief, ...targetingLines].filter(Boolean).join("\n") || null;

    const req = await tx.request.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        status: "SUBMITTED",
        briefSummary,
        sourceListId: list.id,
      },
    });
    return { id: req.id };
  });

  await recordAudit(input.actorUserId, "request.submit", `Request:${request.id}`, {
    orgId: org.id,
    allFirm: false,
    ...(input.auditIp !== undefined ? { ip: input.auditIp } : {}),
  });
  await notifyDesk({
    kind: "RFQ_SUBMITTED",
    title: "New RFQ",
    body: `${org.name} submitted ${productItems.length + titleItems.length} item(s).`,
    link: `/${locale}/desk/${request.id}`,
  });

  return { outcome: "submitted", requestId: request.id };
}
