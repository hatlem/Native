// Version lifecycle rules for an Article's ContentAsset rows.
//
// Every save appends a version, so an article accumulates history: v1 sent
// for review, v2 revised and approved, and so on. Without a rule for the
// older rows, v1 stays "in review" forever — it shows as pending on the
// desk's version timeline and counts toward the buyer's "to review" badge
// even though nobody should ever act on it again.

import { ContentAssetStatus, type Prisma, type PrismaClient } from "@prisma/client";

// A version still in play: being written, awaiting review, or sent back.
export const OPEN_ASSET_STATUSES: readonly ContentAssetStatus[] = [
  ContentAssetStatus.DRAFT,
  ContentAssetStatus.IN_REVIEW,
  ContentAssetStatus.CHANGES_REQUESTED,
];

// Moving a version into one of these hands it over as "the" current text —
// from then on every older open version is stale.
const SUPERSEDING_STATUSES: ReadonlySet<ContentAssetStatus> = new Set([
  ContentAssetStatus.IN_REVIEW,
  ContentAssetStatus.APPROVED,
  ContentAssetStatus.FINAL,
]);

export function supersedesOlderVersions(status: ContentAssetStatus): boolean {
  return SUPERSEDING_STATUSES.has(status);
}

// Terminal states: no further transition may start from them.
export function isTerminalAssetStatus(status: ContentAssetStatus): boolean {
  return status === ContentAssetStatus.SUPERSEDED;
}

type Db = PrismaClient | Prisma.TransactionClient;

// Marks every OPEN version older than `version` as SUPERSEDED. Approved and
// final versions are left alone: they record what was signed off, and a
// FINAL one may be locked by a placement. Returns how many rows changed.
// Mirrored by migration 20260930180100_supersede_stale_content_versions.
export async function supersedeOlderVersions(
  db: Db,
  args: { articleId: string; version: number },
): Promise<number> {
  const { count } = await db.contentAsset.updateMany({
    where: {
      articleId: args.articleId,
      version: { lt: args.version },
      status: { in: [...OPEN_ASSET_STATUSES] },
    },
    data: { status: ContentAssetStatus.SUPERSEDED },
  });
  return count;
}
