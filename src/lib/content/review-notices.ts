// Who hears about a draft changing hands, and with what. Shared by the
// buyer's review actions (content-review-actions.ts) and the desk/writer
// status machine (desk-content-actions.ts) so a change request always
// reaches the writer who has to act on it, with the reviewer's comment —
// before, the desk got an empty "Buyer requested changes to a draft" and the
// writer found out only by opening the line.

import { prisma } from "@/lib/prisma";
import { notifyDesk, notifyOrg, notifyUser } from "@/lib/notify";
import { writerFallbackLocale } from "@/lib/writers/notify";

export type DraftNoticeContext = {
  articleId: string;
  articleTitle: string;
  version: number;
  organizationId: string;
  orgName: string;
  // The order the draft runs on: the caller's hint when it came from an
  // order page, else the article's first live placement; null for an
  // article not placed on any order.
  orderId: string | null;
  // The writer who acts on the draft (the article's assigned writer, else a
  // placement's), with their line page; null when nobody is assigned.
  writer: { writerId: string; userId: string; orderLineId: string | null } | null;
};

export async function draftNoticeContext(
  assetId: string,
  orderIdHint: string | null = null,
): Promise<DraftNoticeContext | null> {
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: {
      version: true,
      article: {
        select: {
          id: true,
          title: true,
          organizationId: true,
          organization: { select: { name: true } },
          assignedWriter: { select: { id: true, userId: true } },
          placements: {
            where: { retractedAt: null },
            orderBy: { createdAt: "asc" },
            select: {
              orderLineId: true,
              orderLine: {
                select: {
                  orderId: true,
                  assignedWriter: { select: { id: true, userId: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!asset) return null;
  const { article } = asset;
  const placements = article.placements;
  const writer = article.assignedWriter ?? placements.find((p) => p.orderLine.assignedWriter)?.orderLine.assignedWriter ?? null;
  const writerLine = writer
    ? (placements.find((p) => p.orderLine.assignedWriter?.id === writer.id) ?? placements[0] ?? null)
    : null;
  return {
    articleId: article.id,
    articleTitle: article.title,
    version: asset.version,
    organizationId: article.organizationId,
    orgName: article.organization.name,
    orderId: orderIdHint ?? placements[0]?.orderLine.orderId ?? null,
    writer: writer
      ? { writerId: writer.id, userId: writer.userId, orderLineId: writerLine?.orderLineId ?? null }
      : null,
  };
}

function draftParams(ctx: DraftNoticeContext) {
  return {
    articleTitle: ctx.articleTitle,
    articleId: ctx.articleId,
    version: ctx.version,
    orderId: ctx.orderId,
  };
}

/** The buyer org: a draft is ready for their review. */
export async function notifyDraftReady(ctx: DraftNoticeContext): Promise<void> {
  await notifyOrg(ctx.organizationId, {
    kind: "ASSET_REVIEW",
    template: { key: "draftReady", params: draftParams(ctx) },
  });
}

/** The desk: the buyer approved a draft. */
export async function notifyDraftApprovedByBuyer(ctx: DraftNoticeContext): Promise<void> {
  await notifyDesk({
    kind: "ASSET_REVIEW",
    template: { key: "deskDraftApproved", params: { ...draftParams(ctx), orgName: ctx.orgName } },
  });
}

/** A change request: the desk sees the buyer's comment; the assigned writer
 *  is told either way (they do the rewrite); the buyer hears when the desk
 *  sent their draft back. */
export async function notifyChangesRequested(
  ctx: DraftNoticeContext,
  by: "client" | "desk",
  comment: string | null,
): Promise<void> {
  if (by === "client") {
    await notifyDesk({
      kind: "ASSET_REVIEW",
      template: {
        key: "deskChangesRequested",
        params: { ...draftParams(ctx), orgName: ctx.orgName, comment },
      },
    });
  } else {
    await notifyOrg(ctx.organizationId, {
      kind: "ASSET_REVIEW",
      template: { key: "draftSentBack", params: draftParams(ctx) },
    });
  }
  if (ctx.writer) {
    await notifyUser(
      ctx.writer.userId,
      {
        kind: "ASSET_REVIEW",
        template: {
          key: "writerChangesRequested",
          params: {
            articleTitle: ctx.articleTitle,
            version: ctx.version,
            requestedBy: by,
            comment,
            orderLineId: ctx.writer.orderLineId,
          },
        },
      },
      { fallbackLocale: await writerFallbackLocale(ctx.writer.writerId) },
    );
  }
}
