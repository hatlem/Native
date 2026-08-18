// Single source of truth for self-serve (FIRM) order creation. The /plan
// checkout action and the POST /api/v1/orders endpoint both call
// createFirmOrder so the Plan→Request→Quote(s)→Order machinery — and its
// per-market currency/VAT split — exists in exactly one place.
//
// The caller is responsible for the gates that depend on its own context:
// FIRM-visibility of every product, commit authority, availability, and
// rate limiting. This function assumes the basket is already cleared to
// auto-confirm and just mints the records.

import { prisma } from "@/lib/prisma";
import {
  computeQuoteLines,
  quoteTotals,
  resolveDefaultMarginPct,
  toRateRules,
  type QuotableItem,
} from "@/lib/money";
import { groupItemsByMarket } from "@/lib/quote-grouping";
import { loadPricingDefaults, contentFeeLinesForGroup } from "@/lib/content-fee";
import { planWindowFromItems, type BookingUnit } from "@/lib/campaign-schedule";
import {
  authorshipFromWithContent,
  authorshipForOrderLine,
  type AuthorshipMode,
} from "@/lib/authorship";

// Minimal product shape the quote engine needs. Both the self-serve basket
// query and the desk quote query hydrate at least these fields.
export type ProductWithRules = {
  id: string;
  name: string;
  basePrice: unknown;
  priceRules: {
    marginPct: unknown;
    seasonalMultiplier: unknown;
    minVolume: number;
  }[];
};

export function toQuotable(
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

// Full product shape createFirmOrder needs: the rate-card fields toQuotable
// reads, plus the market relation groupItemsByMarket groups on, plus the
// `type` contentFeeLinesForGroup prices from. Both the self-serve basket
// query and the API order query hydrate at least these.
export type FirmOrderProduct = ProductWithRules & {
  type: string;
  // Schedule-grid unit (WEEK|MONTH) — turns a line's scheduleUnits into a
  // flight window. Optional: the public API's product query may not hydrate
  // it, in which case MONTH (the catalog default) is assumed.
  bookingUnit?: BookingUnit;
  title: {
    marketId: string;
    market: { code: string; currency: string; vatRatePct: unknown };
  };
};

export type FirmOrderItem = {
  productId: string;
  quantity: number;
  withContent?: boolean;
  // Buyer's chosen flight for this line (SavedListItem.scheduleStart/Units).
  // Snapshotted onto PlanItem; min/max becomes Plan.startDate/endDate.
  scheduleStart?: Date | null;
  scheduleUnits?: number | null;
};

/** Thrown when a product became unavailable between the caller's snapshot and
 *  the committing transaction. The caller should bounce the buyer to review the
 *  refreshed basket rather than instant-charge a stale one. */
export class FirmOrderStaleError extends Error {
  constructor(message = "firm order stale") {
    super(message);
    this.name = "FirmOrderStaleError";
  }
}

export type FirmOrderBrief = {
  // Freeform brief text → Request.briefSummary (with targeting lines folded in).
  briefText?: string | null;
  // Campaign goal → Plan.goal + each ContentBrief.message.
  goal?: string | null;
  audience?: string | null;
  budget?: number | null;
  currency?: string | null;
  targetGeo?: string | null;
  targetAudience?: string | null;
  targetContext?: string | null;
};

// Creates a CONFIRMED, auto-accepted order for an all-FIRM basket and
// returns the created Request id + order ids. Caller must have verified
// FIRM-visibility / availability / commit authority first.
export async function createFirmOrder(args: {
  organizationId: string;
  orgName: string;
  items: FirmOrderItem[];
  byId: Map<string, FirmOrderProduct>;
  brief?: FirmOrderBrief;
  sourceListId?: string | null;
}): Promise<{ requestId: string; orderIds: string[] }> {
  const { organizationId, orgName, items, byId, brief, sourceListId } = args;
  const goal = brief?.goal ?? null;
  const audience = brief?.audience ?? null;
  const targetGeo = brief?.targetGeo ?? null;
  const targetAudience = brief?.targetAudience ?? null;
  const targetContext = brief?.targetContext ?? null;

  // Multi-currency split: one Quote per placement market — grouping by
  // market (not currency) keeps the EUR markets (DE/AT/IE/FI) apart since
  // they share EUR but have different VAT rates.
  const groups = groupItemsByMarket(items, byId);
  // Legacy Plan.currency: single-market basket keeps its one currency;
  // multi-market leaves it null (per-Quote currencies are the truth).
  const planCurrency = groups.length === 1 ? groups[0].currency : null;
  // Fee rules and margin defaults come from the same load so the order
  // agrees with the catalog band the buyer saw (display-price.ts).
  const defaults = await loadPricingDefaults();

  // Per-product authorship intent (projected from the buyer's withContent
  // toggle), used to stamp both the PlanItem and the eventual OrderLine.
  const authorshipByProduct = new Map<string, AuthorshipMode>(
    items.map((i) => [i.productId, authorshipFromWithContent(i.withContent)]),
  );

  return prisma.$transaction(async (tx) => {
    // Serialize firm-order creation per org so two simultaneous submits can't
    // both mint a charged order — the second blocks here, then the dedup below
    // short-circuits it. Transaction-scoped lock, auto-released on commit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;

    // Idempotency: a retried / concurrent submit of the SAME saved list within a
    // short window returns the order the first submit created — never a second
    // charge. (Only /plan checkout passes sourceListId; the public API doesn't.)
    if (sourceListId) {
      const existing = await tx.request.findFirst({
        where: { sourceListId, organizationId, createdAt: { gt: new Date(Date.now() - 30_000) } },
        orderBy: { createdAt: "desc" },
        select: { id: true, quotes: { select: { order: { select: { id: true } } } } },
      });
      if (existing) {
        console.warn("firmorder.dedup_hit", { organizationId, sourceListId, requestId: existing.id });
        return {
          requestId: existing.id,
          orderIds: existing.quotes.map((q) => q.order?.id).filter((id): id is string => !!id),
        };
      }
    }

    // Re-validate against FRESH data inside the transaction: a product
    // deactivated/unbooked after the caller's snapshot must not be instant-
    // charged. We still price from the snapshot (the price the buyer saw), but
    // refuse to charge for anything no longer purchasable.
    const productIds = [...new Set(items.map((i) => i.productId))];
    const liveCount = await tx.product.count({
      where: { id: { in: productIds }, active: true, bookable: true },
    });
    if (liveCount !== productIds.length) {
      console.warn("firmorder.stale", { organizationId, expected: productIds.length, live: liveCount });
      throw new FirmOrderStaleError("A selected product is no longer available.");
    }

    const flight = planWindowFromItems(
      items.map((i) => ({
        scheduleStart: i.scheduleStart ?? null,
        scheduleUnits: i.scheduleUnits ?? null,
        bookingUnit: byId.get(i.productId)?.bookingUnit ?? "MONTH",
      })),
    );
    const plan = await tx.plan.create({
      data: {
        organizationId,
        name: `${orgName} — campaign`,
        budget: brief?.budget ?? null,
        currency: brief?.currency ?? planCurrency,
        startDate: flight.start,
        endDate: flight.end,
        goal,
        audienceNote: audience,
        targetGeo,
        targetAudience,
        targetContext,
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            withContent: i.withContent ?? false,
            authorshipMode: authorshipByProduct.get(i.productId)!,
            scheduleStart: i.scheduleStart ?? null,
            scheduleUnits: i.scheduleUnits ?? null,
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
      [brief?.briefText, ...targetingLines].filter(Boolean).join("\n") || null;

    const req = await tx.request.create({
      data: {
        organizationId,
        planId: plan.id,
        status: "CLOSED",
        briefSummary,
        sourceListId: sourceListId ?? null,
      },
    });

    const orderIds: string[] = [];
    for (const group of groups) {
      const lines = [
        ...computeQuoteLines(
          group.items.map((i) =>
            toQuotable(byId.get(i.productId)!, i.quantity),
          ),
          resolveDefaultMarginPct(defaults.marginRules, group.marketCode),
        ),
        ...contentFeeLinesForGroup(
          group.items,
          byId,
          group.marketCode,
          defaults.feeRules,
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
          organizationId,
          quoteId: quote.id,
          status: "CONFIRMED",
          flightStartDate: plan.startDate ?? null,
          flightEndDate: plan.endDate ?? null,
          lines: {
            create: lines.map((l) => ({
              kind: l.kind,
              authorshipMode: authorshipForOrderLine(l, authorshipByProduct),
              productId: l.productId,
              quantity: l.quantity,
              lineTotal: l.lineTotal,
            })),
          },
        },
        include: { lines: true },
      });
      orderIds.push(order.id);
      // Briefs and publisher bookings attach only to inventory lines —
      // a CONTENT_FEE line is a billing line for production work that
      // is briefed/fulfilled against the placement line itself.
      const placementLines = order.lines.filter((l) => l.kind === "INVENTORY");
      await tx.contentBrief.createMany({
        data: placementLines.map((l) => ({
          orderLineId: l.id,
          message: goal,
          audience,
        })),
      });
      // Resolve title/publisher for placement lines so each booking is anchored to
      // its publisher at creation (the campaign report groups by it).
      const placementProductIds = placementLines.map((l) => l.productId).filter((id): id is string => !!id);
      const placementProducts = await tx.product.findMany({
        where: { id: { in: placementProductIds } },
        select: { id: true, titleId: true, title: { select: { publisherId: true } } },
      });
      const titleByProduct = new Map(placementProducts.map((p) => [p.id, { titleId: p.titleId, publisherId: p.title.publisherId }]));

      await tx.publisherBooking.createMany({
        data: placementLines.map((l) => {
          const ref = l.productId ? titleByProduct.get(l.productId) : undefined;
          return { orderLineId: l.id, titleId: ref?.titleId ?? null, publisherId: ref?.publisherId ?? null };
        }),
      });
    }

    return { requestId: req.id, orderIds };
  });
}
