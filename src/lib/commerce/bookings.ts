// Publisher bookings for the placement lines of a newly created order.
// Shared by both order factories — the instant/firm path (firm-order.ts) and
// the quote-accept path (accept-quote.ts) — so a booking is always anchored
// to its title and publisher at creation. The campaign report, its CSV and
// the metrics sweep (which groups bookings by publisherId) all read those
// denormalized columns; the accept path used to write only orderLineId.

import type { Prisma } from "@prisma/client";

export async function createPublisherBookings(
  tx: Prisma.TransactionClient,
  placementLines: { id: string; productId: string | null }[],
): Promise<void> {
  if (placementLines.length === 0) return;
  const productIds = [
    ...new Set(placementLines.map((l) => l.productId).filter((id): id is string => !!id)),
  ];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, titleId: true, title: { select: { publisherId: true } } },
  });
  const refByProduct = new Map(
    products.map((p) => [p.id, { titleId: p.titleId, publisherId: p.title.publisherId }]),
  );
  await tx.publisherBooking.createMany({
    data: placementLines.map((l) => {
      const ref = l.productId ? refByProduct.get(l.productId) : undefined;
      return {
        orderLineId: l.id,
        titleId: ref?.titleId ?? null,
        publisherId: ref?.publisherId ?? null,
      };
    }),
  });
}
