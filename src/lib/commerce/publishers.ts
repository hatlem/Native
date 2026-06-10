import { prisma } from "@/lib/prisma";

// Distinct publishers behind a set of products — used to fan out
// booking notifications after checkout / quote acceptance.
export async function uniquePublisherIdsForProducts(
  productIds: string[],
): Promise<string[]> {
  if (productIds.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { title: { select: { publisherId: true } } },
  });
  return [...new Set(rows.map((r) => r.title.publisherId))];
}
