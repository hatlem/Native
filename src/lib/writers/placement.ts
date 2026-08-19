import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type EffectiveAsset = {
  id: string;
  status: string;
  body: string | null;
  bodyUrl: string | null;
  reviewNotes: string | null;
};

// The display title a new Article gets when born from a specific line: the
// line's product/title name, falling back to a generic label. Shared by
// every line-keyed article-creation entry point (Task 5's saveLineDraft and
// its fix to writer-pool-actions.ts's assignWriterToLine).
export async function articleTitleForLine(orderLineId: string): Promise<string> {
  const line = await prisma.orderLine.findUnique({
    where: { id: orderLineId },
    select: { productId: true },
  });
  const product = line?.productId
    ? await prisma.product.findUnique({
        where: { id: line.productId },
        select: { title: { select: { name: true } } },
      })
    : null;
  return product?.title.name ?? "Untitled article";
}

// Which ContentAsset a placement is currently showing: its locked version
// once one exists (set the moment any version of the article went FINAL
// while this placement was linked and unlocked), otherwise the article's
// latest version.
export async function resolveEffectiveAsset(placement: {
  articleId: string;
  lockedAssetId: string | null;
}): Promise<EffectiveAsset | null> {
  if (placement.lockedAssetId) {
    return prisma.contentAsset.findUnique({
      where: { id: placement.lockedAssetId },
      select: { id: true, status: true, body: true, bodyUrl: true, reviewNotes: true },
    });
  }
  return prisma.contentAsset.findFirst({
    where: { articleId: placement.articleId },
    orderBy: { version: "desc" },
    select: { id: true, status: true, body: true, bodyUrl: true, reviewNotes: true },
  });
}

// Idempotently gets (or creates) the ArticlePlacement + Article that owns a
// line's drafts. An OrderLine's placement can be born from either side —
// the desk staffing a writer, or the desk/a writer composing the first
// draft — so both call this rather than each running their own
// find-then-create.
//
// `assignedWriterId` is applied to the ARTICLE (writing assignment is
// shared across every placement of that article, not per-placement) on
// both the found-existing and newly-created paths; omit it entirely to
// leave an existing article's writer untouched.
export async function ensurePlacementForLine(args: {
  orderLineId: string;
  organizationId: string;
  title: string;
  createdByUserId: string;
  createdByRole: UserRole;
  assignedWriterId?: string | null;
}): Promise<{ id: string; articleId: string }> {
  const existing = await prisma.articlePlacement.findUnique({
    where: { orderLineId: args.orderLineId },
    select: { id: true, articleId: true },
  });
  if (existing) {
    if (args.assignedWriterId !== undefined) {
      await prisma.article.update({
        where: { id: existing.articleId },
        data: { assignedWriterId: args.assignedWriterId },
      });
    }
    return existing;
  }
  const article = await prisma.article.create({
    data: {
      organizationId: args.organizationId,
      title: args.title,
      createdByUserId: args.createdByUserId,
      createdByRole: args.createdByRole,
      assignedWriterId: args.assignedWriterId ?? null,
    },
  });
  try {
    return await prisma.articlePlacement.create({
      data: { orderLineId: args.orderLineId, articleId: article.id },
      select: { id: true, articleId: true },
    });
  } catch (error) {
    // Two first-writes for the same line can race on the unique
    // orderLineId (creating the Article isn't part of the same atomic
    // insert as claiming the placement) — the loser adopts the winner's
    // row. The loser's freshly-created Article is left orphaned
    // (unlinked, unreferenced by anything) rather than cleaned up —
    // harmless, and cheaper than adding transactional coordination for
    // an already-rare race.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.articlePlacement.findUniqueOrThrow({
        where: { orderLineId: args.orderLineId },
        select: { id: true, articleId: true },
      });
    }
    throw error;
  }
}

// Called right after a ContentAsset transitions to FINAL: every placement
// of that article not yet locked to a specific version locks to this one.
// Placements that already locked to an earlier FINAL version are left
// alone (each locks exactly once, at its own first FINAL).
export async function lockPlacementsOnFinal(articleId: string, assetId: string): Promise<void> {
  await prisma.articlePlacement.updateMany({
    where: { articleId, lockedAssetId: null },
    data: { lockedAssetId: assetId },
  });
}
