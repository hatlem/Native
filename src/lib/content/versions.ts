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

// Where a version may go next. The desk drives the machine, but only
// forward: an APPROVED version is signed off, so its next step is FINAL
// (which locks the placements), not another round of review; FINAL and
// SUPERSEDED are history. The desk may approve without a formal review
// round (the buyer said yes by email) and may send an approval back only
// while it's still in review. Other roles only ever hand a draft over for
// review (desk-content-actions SELF_SERVE_ASSET_TARGETS), a subset of this.
const NEXT_ASSET_STATUSES: Readonly<Record<ContentAssetStatus, readonly ContentAssetStatus[]>> = {
  DRAFT: [ContentAssetStatus.IN_REVIEW, ContentAssetStatus.APPROVED],
  CHANGES_REQUESTED: [ContentAssetStatus.IN_REVIEW, ContentAssetStatus.APPROVED],
  IN_REVIEW: [ContentAssetStatus.APPROVED, ContentAssetStatus.CHANGES_REQUESTED],
  APPROVED: [ContentAssetStatus.FINAL],
  FINAL: [],
  SUPERSEDED: [],
};

export function nextAssetStatuses(from: ContentAssetStatus): readonly ContentAssetStatus[] {
  return NEXT_ASSET_STATUSES[from];
}

export function canMoveAsset(from: ContentAssetStatus, to: ContentAssetStatus): boolean {
  return NEXT_ASSET_STATUSES[from].includes(to);
}

// Terminal states: no further transition may start from them.
export function isTerminalAssetStatus(status: ContentAssetStatus): boolean {
  return status === ContentAssetStatus.SUPERSEDED;
}

type Db = PrismaClient | Prisma.TransactionClient;

// The round a version handed over for review now opens: one past the
// article's highest round so far. Rounds count hand-overs to the client,
// not saves — `version` goes up on every save, so numbering the buyer's
// first review "Version 5" exposed the writer's drafts. A version sent back
// and resubmitted as-is opens a new round too: the buyer reviews it again.
//
// Call inside the transaction that writes the round: the article row is
// locked first, so two concurrent hand-overs can't both read the same max.
export async function nextReviewRound(tx: Prisma.TransactionClient, articleId: string): Promise<number> {
  await tx.$queryRaw`SELECT 1 FROM "Article" WHERE "id" = ${articleId} FOR UPDATE`;
  const { _max } = await tx.contentAsset.aggregate({
    where: { articleId },
    _max: { reviewRound: true },
  });
  return (_max.reviewRound ?? 0) + 1;
}

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
