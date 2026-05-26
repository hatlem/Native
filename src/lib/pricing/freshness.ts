import { prisma } from "@/lib/prisma";
import type { MarketCode } from "@prisma/client";

// Pure helpers — testable without Prisma.

export function latestConfirmedAtAcrossProducts(
  products: Array<{ confirmedAt: Date | null }>,
): Date | null {
  let latest: Date | null = null;
  for (const p of products) {
    if (!p.confirmedAt) continue;
    if (!latest || p.confirmedAt.getTime() > latest.getTime()) {
      latest = p.confirmedAt;
    }
  }
  return latest;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function ageInDays(when: Date | null, now: Date = new Date()): number | null {
  if (!when) return null;
  return Math.floor((now.getTime() - when.getTime()) / DAY_MS);
}

export type FreshnessBucket = "never" | "fresh" | "aging" | "stale";

export function freshnessBucket(
  confirmedAt: Date | null,
  now: Date = new Date(),
): FreshnessBucket {
  const age = ageInDays(confirmedAt, now);
  if (age === null) return "never";
  if (age <= 30) return "fresh";
  if (age <= 90) return "aging";
  return "stale";
}

// DB-backed: titles that need a price refresh by age cutoff.
// Returns title id + name + market code + age in days, oldest first.
export async function titlesNeedingCheck(args: {
  marketCode?: MarketCode;
  publisherId?: string;
  olderThanDays: number;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    name: string;
    slug: string;
    marketCode: MarketCode;
    publisherName: string;
    latestConfirmedAt: Date | null;
    ageDays: number | null;
  }>
> {
  const titles = await prisma.title.findMany({
    where: {
      active: true,
      ...(args.marketCode ? { market: { code: args.marketCode } } : {}),
      ...(args.publisherId ? { publisherId: args.publisherId } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      market: { select: { code: true } },
      publisher: { select: { name: true } },
      products: { select: { confirmedAt: true } },
    },
  });

  const now = new Date();
  const cutoffMs = args.olderThanDays * DAY_MS;

  return titles
    .map((t) => {
      const latest = latestConfirmedAtAcrossProducts(t.products);
      const age = ageInDays(latest, now);
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        marketCode: t.market.code,
        publisherName: t.publisher.name,
        latestConfirmedAt: latest,
        ageDays: age,
      };
    })
    .filter((t) => {
      if (t.latestConfirmedAt === null) return true; // never confirmed → always needs check
      return now.getTime() - t.latestConfirmedAt.getTime() >= cutoffMs;
    })
    .sort((a, b) => {
      if (a.latestConfirmedAt === null && b.latestConfirmedAt === null) return 0;
      if (a.latestConfirmedAt === null) return -1;
      if (b.latestConfirmedAt === null) return 1;
      return a.latestConfirmedAt.getTime() - b.latestConfirmedAt.getTime();
    })
    .slice(0, args.limit ?? 200);
}
