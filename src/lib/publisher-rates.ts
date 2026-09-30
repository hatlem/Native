// Publisher self-serve rate confirmation — the portal-side counterpart to
// the desk's email harvesting. A signed-in publisher confirms or updates
// the base price of their OWN products, which both freshens the catalog's
// core asset ("confirmed, never guessed") and records first-party
// provenance: `confirmedSource` says the publisher themselves stamped it.
//
// Deliberately price-only. This path never touches visibility / active /
// bookable — the desk keeps the curation gate. Note that `confirmedAt` is
// also the catalog's confirmation gate (an active product only surfaces
// with confirmedAt set), so a publisher confirming a price can make an
// already-active-but-unconfirmed product surface — that is the point:
// a first-party confirmation is the strongest provenance we have.

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyDesk } from "@/lib/notify";
import type { BookingUnit, PricingModel, ProductType } from "@prisma/client";

export class PublisherRatesError extends Error {
  constructor(public code: "not-found" | "invalid-price" | "invalid-lead-time") {
    super(`publisher-rates:${code}`);
    this.name = "PublisherRatesError";
  }
}

// Upper bound guards against fat-finger extra zeros (a 10M+ flat price is
// not a real native rate in any of our markets), lower bound rejects the
// "clear the field and save" accident that would zero a confirmed price.
export const MAX_BASE_PRICE = 10_000_000;

export function isValidBasePrice(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_BASE_PRICE
  );
}

// Form input → validated price. Accepts "12 500" / "12500.50"-style input
// (the number field posts a plain string); null means "reject the post".
export function parseBasePrice(raw: string): number | null {
  const cleaned = raw.replace(/\s+/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return isValidBasePrice(n) ? n : null;
}

export type RateCardProduct = {
  id: string;
  name: string;
  type: ProductType;
  basePrice: number;
  currency: string;
  pricingModel: PricingModel;
  bookingUnit: BookingUnit;
  minDurationUnits: number | null;
  active: boolean;
  bookable: boolean;
  confirmedAt: Date | null;
};

export type RateCardTitle = {
  id: string;
  name: string;
  active: boolean;
  products: RateCardProduct[];
};

// Every non-discontinued title of the publisher with its full product
// list — including inactive/unbookable products, because a publisher can
// legitimately confirm the price of a product the desk hasn't switched on
// yet (that confirmation is exactly what the desk is waiting for).
export async function loadPublisherRateCard(
  publisherId: string,
): Promise<RateCardTitle[]> {
  const titles = await prisma.title.findMany({
    where: { publisherId, discontinuedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      active: true,
      products: {
        orderBy: [{ type: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          type: true,
          basePrice: true,
          currency: true,
          pricingModel: true,
          bookingUnit: true,
          minDurationUnits: true,
          active: true,
          bookable: true,
          confirmedAt: true,
        },
      },
    },
  });
  return titles.map((t) => ({
    ...t,
    products: t.products.map((p) => ({
      ...p,
      basePrice: Number(p.basePrice),
    })),
  }));
}

// Lead time is the publisher's own operational fact (how many days they need
// before a placement can run), so it stays self-serve — but capped, so a stray
// extra digit can't silently push a title out of every campaign window.
export const MAX_LEAD_TIME_DAYS = 365;

export function parseLeadTimeDays(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_LEAD_TIME_DAYS ? n : null;
}

// Ownership guard shared by every mutation. Resolves the product ONLY via
// the (publisherId, productId) pair — the posted id is never trusted on
// its own, so one publisher can never stamp or reprice another's product.
// A miss is indistinguishable from "no such product" by design.
async function ownProduct(publisherId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, title: { publisherId } },
    select: {
      id: true,
      titleId: true,
      type: true,
      basePrice: true,
      currency: true,
      title: { select: { name: true } },
    },
  });
  if (!product) throw new PublisherRatesError("not-found");
  return product;
}

function publisherSource(actorUserId: string): string {
  return `publisher-portal:User:${actorUserId}`;
}

// "This price is still right." Stamps provenance without touching the
// price itself.
export async function confirmProductPrice(args: {
  publisherId: string;
  productId: string;
  actorUserId: string;
}): Promise<void> {
  const product = await ownProduct(args.publisherId, args.productId);
  // "Still right" only means something for a real price. A blueprint
  // skeleton carries basePrice 0 (unpriced) — confirming that would stamp
  // a 0 kr price as publisher-confirmed; the publisher must enter the rate.
  if (!isValidBasePrice(Number(product.basePrice))) {
    throw new PublisherRatesError("invalid-price");
  }
  await prisma.product.update({
    where: { id: product.id },
    data: {
      confirmedAt: new Date(),
      confirmedSource: publisherSource(args.actorUserId),
    },
  });
  await recordAudit(
    args.actorUserId,
    "product.price_confirm",
    `Product:${product.id}`,
    { publisherId: args.publisherId, basePrice: Number(product.basePrice) },
  );
}

// "The price changed." Updates basePrice and stamps the same first-party
// provenance, then tells the desk — a self-serve price change on live
// inventory is exactly the kind of thing the desk wants in its inbox.
export async function updateProductPrice(args: {
  publisherId: string;
  productId: string;
  basePrice: number;
  actorUserId: string;
}): Promise<void> {
  if (!isValidBasePrice(args.basePrice)) {
    throw new PublisherRatesError("invalid-price");
  }
  const product = await ownProduct(args.publisherId, args.productId);
  const from = Number(product.basePrice);
  await prisma.product.update({
    where: { id: product.id },
    data: {
      basePrice: args.basePrice,
      confirmedAt: new Date(),
      confirmedSource: publisherSource(args.actorUserId),
    },
  });
  await recordAudit(
    args.actorUserId,
    "product.price_update",
    `Product:${product.id}`,
    { publisherId: args.publisherId, from, to: args.basePrice },
  );
  // QUOTE_READY is the least-bad existing kind: "fresh pricing is ready
  // for you to look at". Adding a dedicated enum value is a migration we
  // deliberately avoid here.
  await notifyDesk({
    kind: "QUOTE_READY",
    template: {
      key: "publisherPriceUpdated",
      params: {
        titleName: product.title.name,
        titleId: product.titleId,
        productType: product.type,
        from,
        to: args.basePrice,
        currency: product.currency,
      },
    },
  });
}

// "We now need N days' notice." The only catalog field besides the price a
// publisher edits from the portal. Visibility (FIRM = instant order) and
// bookable are the desk's call — the rates page tells publishers exactly that
// — so they are deliberately not parameters here. The desk hears about the
// change: a longer lead time can make an already-planned flight unbookable.
export async function updateProductLeadTime(args: {
  publisherId: string;
  productId: string;
  leadTimeDays: number;
  actorUserId: string;
}): Promise<{ changed: boolean }> {
  if (
    !Number.isInteger(args.leadTimeDays) ||
    args.leadTimeDays < 1 ||
    args.leadTimeDays > MAX_LEAD_TIME_DAYS
  ) {
    throw new PublisherRatesError("invalid-lead-time");
  }
  const product = await ownProduct(args.publisherId, args.productId);
  const current = await prisma.product.findUniqueOrThrow({
    where: { id: product.id },
    select: { leadTimeDays: true },
  });
  if (current.leadTimeDays === args.leadTimeDays) return { changed: false };
  await prisma.product.update({
    where: { id: product.id },
    data: { leadTimeDays: args.leadTimeDays },
  });
  await recordAudit(
    args.actorUserId,
    "product.lead_time_update",
    `Product:${product.id}`,
    { publisherId: args.publisherId, from: current.leadTimeDays, to: args.leadTimeDays },
  );
  await notifyDesk({
    kind: "QUOTE_READY",
    template: {
      key: "publisherLeadTimeUpdated",
      params: {
        titleName: product.title.name,
        titleId: product.titleId,
        productType: product.type,
        from: current.leadTimeDays,
        to: args.leadTimeDays,
      },
    },
  });
  return { changed: true };
}
