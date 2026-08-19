import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import type { MarketCode } from "@prisma/client";

function slugify(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics so "Akeritidning" -> "akeritidning"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "title";
}

// Title.slug is globally unique. Append a short numeric suffix until free
// rather than erroring, mirroring the ingestion path's uniqueSlug.
async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let n = 1;
  while (await prisma.title.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${n++}`;
    if (n > 50) {
      candidate = `${base}-${Date.now()}`;
      break;
    }
  }
  return candidate;
}

export async function searchPublishers(args: { query: string; market?: MarketCode; limit: number }) {
  const q = args.query.trim();
  return prisma.publisher.findMany({
    where: {
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      ...(args.market ? { market: { code: args.market } } : {}),
    },
    include: { market: true },
    orderBy: { name: "asc" },
    take: args.limit,
  });
}

// New title created via the desk/MCP flow, e.g. transcribing a publisher
// reply for a publication that isn't in the catalog yet. Requires an
// existing publisherId — creating a brand-new Publisher entity (legal
// name, contract terms) is a bigger decision left to the desk UI, not
// something to infer blind from an email signature.
export async function createTitle(args: {
  publisherId: string;
  name: string;
  category: string;
  websiteUrl?: string;
  audienceNote?: string;
  // We only mark a freshly-created title LIVE when the caller has an
  // actual positive confirmation (e.g. a sales contact replied with real
  // prices) — otherwise it stays UNVERIFIED, the honest default.
  verifiedFromReply?: boolean;
  verificationSource?: string;
  actorId: string;
}) {
  const publisher = await prisma.publisher.findUniqueOrThrow({
    where: { id: args.publisherId },
    select: { marketId: true, countryCode: true },
  });
  const slug = await uniqueSlug(slugify(args.name));
  const title = await prisma.title.create({
    data: {
      name: args.name.trim(),
      slug,
      publisherId: args.publisherId,
      marketId: publisher.marketId,
      countryCode: publisher.countryCode,
      category: args.category,
      websiteUrl: args.websiteUrl?.trim() || null,
      audienceNote: args.audienceNote?.trim() || null,
      active: false, // curation gate — desk activates once reviewed
      verificationStatus: args.verifiedFromReply ? "LIVE" : "UNVERIFIED",
      verificationSource: args.verificationSource?.trim() || null,
      lastVerifiedAt: args.verifiedFromReply ? new Date() : null,
    },
  });
  await recordAudit(args.actorId, "title.create", `Title:${title.id}`, {
    publisherId: args.publisherId,
    name: title.name,
    slug: title.slug,
  });
  return title;
}
