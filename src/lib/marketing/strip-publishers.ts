import { prisma } from "@/lib/prisma";

export type StripPublisher = { id: string; name: string; logoUrl: string | null };

// Top publishers by title count — the same ordering (and exclusions) the
// homepage grid uses, surfaced as a slim logo/name strip. Real publishers
// only; Universitetsforlaget (academic press) is kept out of the showcase
// in both places.
export async function getStripPublishers(limit = 10): Promise<StripPublisher[]> {
  const rows = await prisma.publisher.findMany({
    where: { titles: { some: {} }, NOT: { name: { startsWith: "Universitetsforlaget" } } },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      _count: { select: { titles: true } },
    },
  });
  return rows
    .sort((a, b) => b._count.titles - a._count.titles)
    .slice(0, limit)
    .map((p) => ({ id: p.id, name: p.name, logoUrl: p.logoUrl }));
}
