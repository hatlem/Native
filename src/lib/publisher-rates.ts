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
  constructor(public code: "not-found" | "invalid-price") {
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

// Ownership guard shared by both mutations. Resolves the product ONLY via
// the (publisherId, productId) pair — the posted id is never trusted on
// its own, so one publisher can never stamp or reprice another's product.
// A miss is indistinguishable from "no such product" by design.
async function ownProduct(publisherId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, title: { publisherId } },
    select: {
      id: true,
      titleId: true,
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
  // Only used to build the desk notification link; desk UI is per-locale.
  locale?: string;
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
  const locale = args.locale ?? "en";
  await notifyDesk({
    kind: "QUOTE_READY",
    title: "Publisher updated a price",
    body: `${product.title.name}: ${from} → ${args.basePrice} ${product.currency} (confirmed by the publisher)`,
    link: `/${locale}/desk/titles/${product.titleId}`,
  });
}
