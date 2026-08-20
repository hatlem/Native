"use server";

import { redirect } from "next/navigation";
import { ContentAssetStatus, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg } from "@/lib/notify";
import { enqueue } from "@/lib/jobs";
import { runSpecCheckForPlacement, registerSpecCheckJob } from "@/lib/spec-check-runner";
import { ensureTrackedLinks } from "@/lib/metrics/store";
import { rewriteBodyLinks } from "@/lib/metrics/links";
import { requireLineWriter, requireArticleWriter } from "@/lib/writers/guard";
import {
  ensurePlacementForLine,
  articleTitleForLine,
  lockPlacementsOnFinal,
} from "@/lib/writers/placement";

registerSpecCheckJob();

const ASSET_TARGETS: ContentAssetStatus[] = [
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "FINAL",
];

const SELF_SERVE_ASSET_TARGETS: ReadonlySet<ContentAssetStatus> = new Set([
  ContentAssetStatus.IN_REVIEW,
]);

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Where a content action returns the actor to. `orderLineIdHint`, when
// present, comes from a page that has a specific-placement context (the
// writer's line page) — an article with many placements has no single
// "the" line to derive this from, so it is always an explicit form field,
// never a lookup. Desk/superadmin and everyone else land on the article
// page; only a journalist with a line-context hint goes back to their own
// writer page, which is the only surface that shows the ContentBrief.
function afterContentAction(args: {
  locale: string;
  role: string;
  articleId: string;
  orderLineIdHint: string | null;
}): string {
  const { locale, role, articleId, orderLineIdHint } = args;
  if (role === "CONTENT" && orderLineIdHint) {
    return `/${locale}/writer/lines/${orderLineIdHint}`;
  }
  return `/${locale}/articles/${articleId}`;
}

// Appends a new DRAFT version to an article. Shared by the article-keyed
// and the line-keyed entry points below so both produce identical rows.
// Enqueues a spec check only when a placement is given — an unlinked
// article has no product to check against yet (spec-check-runner would
// just no-op, but there's nothing useful to enqueue for).
async function appendDraftVersion(args: {
  articleId: string;
  body: string;
  sourceAssetId: string | null;
  writerProfileId: string | null;
  userId: string;
  placementIdsToCheck: string[];
}): Promise<void> {
  const latest = await prisma.contentAsset.findFirst({
    where: { articleId: args.articleId },
    orderBy: { version: "desc" },
  });
  const nextVersion = (latest?.version ?? 0) + 1;
  const asset = await prisma.contentAsset.create({
    data: {
      articleId: args.articleId,
      version: nextVersion,
      status: "DRAFT",
      body: args.body,
      sourceAssetId: args.sourceAssetId,
      authorWriterId: args.writerProfileId,
    },
  });
  await recordAudit(args.userId, "asset.draft", `ContentAsset:${asset.id}`, {
    version: nextVersion,
    sourceAssetId: args.sourceAssetId,
  });
  for (const placementId of args.placementIdsToCheck) {
    await enqueue("spec.check", { placementId });
  }
}

// Desk confirms which auto-detected outbound links in a produced article
// to track. Each chosen URL becomes a TrackedLink (idempotent) and the
// asset body is rewritten so the published article uses /go/<token>.
// UNCHANGED from before this task — still line-keyed, still reads/writes
// ContentAsset.body directly by assetId.
export async function confirmTrackedLinks(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const orderLineId = field(formData, "orderLineId");
  const assetId = field(formData, "assetId");
  const { userId } = await requireLineWriter(orderLineId, locale);

  const chosen = formData
    .getAll("trackUrl")
    .map((v) => String(v))
    .filter((url) => /^https?:\/\//.test(url))
    .map((url) => ({ url, label: null }));

  if (chosen.length) {
    const map = await ensureTrackedLinks(orderLineId, chosen);
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      select: { id: true, body: true },
    });
    if (asset?.body) {
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: { body: rewriteBodyLinks(asset.body, map) },
      });
    }
    await recordAudit(userId, "asset.track_links", `ContentAsset:${assetId}`, {
      count: chosen.length,
    });
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function saveDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const body = field(formData, "body");
  const sourceAssetId = field(formData, "sourceAssetId") || null;
  const orderLineIdHint = field(formData, "orderLineId") || null;
  const { userId, writerProfileId, role } = await requireArticleWriter(articleId, locale);

  if (body) {
    const placements = await prisma.articlePlacement.findMany({
      where: { articleId },
      select: { id: true },
    });
    await appendDraftVersion({
      articleId,
      body,
      sourceAssetId,
      writerProfileId,
      userId,
      placementIdsToCheck: placements.map((p) => p.id),
    });
  }
  redirect(afterContentAction({ locale, role, articleId, orderLineIdHint }));
}

// The desk composes drafts from the order page, where the unit of work is
// the order line, not the article. A line drafted before any writer is
// staffed has no placement yet, so create one on the way in.
export async function saveLineDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderLineId = field(formData, "orderLineId");
  const body = field(formData, "body");
  const sourceAssetId = field(formData, "sourceAssetId") || null;
  const { userId, writerProfileId, role } = await requireLineWriter(orderLineId, locale);

  const line = await prisma.orderLine.findUnique({
    where: { id: orderLineId },
    select: {
      orderId: true,
      assignedWriterId: true,
      order: { select: { organizationId: true } },
    },
  });
  if (!line) redirect(`/${locale}/desk/orders`);

  const back =
    role === "CONTENT"
      ? `/${locale}/writer/lines/${orderLineId}`
      : `/${locale}/desk/orders/${line.orderId}`;

  if (body) {
    const placement = await ensurePlacementForLine({
      orderLineId,
      organizationId: line.order.organizationId,
      title: await articleTitleForLine(orderLineId),
      createdByUserId: userId,
      createdByRole: role as UserRole,
      assignedWriterId: line.assignedWriterId,
    });
    await appendDraftVersion({
      articleId: placement.articleId,
      body,
      sourceAssetId,
      writerProfileId,
      userId,
      placementIdsToCheck: [placement.id],
    });
  }
  redirect(back);
}

// The client obtains a presigned PUT url via presignArticleUpload
// (src/app/article-library-actions.ts), PUTs the file directly to R2, then
// submits this action with the returned key as bodyUrl.
export async function saveUploadedDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const bodyUrl = field(formData, "bodyUrl");
  const orderLineIdHint = field(formData, "orderLineId") || null;
  const { userId, writerProfileId, role } = await requireArticleWriter(articleId, locale);
  const back = afterContentAction({ locale, role, articleId, orderLineIdHint });

  // The key round-trips through the browser after the presigned PUT, so it
  // is user-controlled. Pin it to the prefix presignArticleUpload issues
  // for THIS article — otherwise a crafted submit could store any object
  // key in the bucket and have the article page presign a download link
  // for it.
  if (bodyUrl && !bodyUrl.startsWith(`articles/${articleId}/`)) {
    redirect(back);
  }

  if (bodyUrl) {
    const latest = await prisma.contentAsset.findFirst({
      where: { articleId },
      orderBy: { version: "desc" },
    });
    const nextVersion = (latest?.version ?? 0) + 1;
    const asset = await prisma.contentAsset.create({
      data: {
        articleId,
        version: nextVersion,
        status: "DRAFT",
        bodyUrl,
        authorWriterId: writerProfileId,
      },
    });
    await recordAudit(userId, "asset.draft_upload", `ContentAsset:${asset.id}`, {
      version: nextVersion,
    });
    // No spec.check enqueue — uploaded files are never spec-checked.
  }
  redirect(back);
}

// Runs spec check for one specific placement's effective asset. `placementId`
// is required now — spec check is a per-placement concept (Task 3), so
// there is no longer an assetId-keyed entry point.
export async function runSpecCheck(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const placementId = field(formData, "placementId");
  const placement = await prisma.articlePlacement.findUnique({
    where: { id: placementId },
    select: { articleId: true, orderLineId: true },
  });
  const articleId = placement?.articleId ?? "";
  const { userId, role } = await requireArticleWriter(articleId, locale);

  await runSpecCheckForPlacement(placementId);
  await recordAudit(userId, "placement.spec_check", `ArticlePlacement:${placementId}`);

  redirect(afterContentAction({ locale, role, articleId, orderLineIdHint: placement?.orderLineId ?? null }));
}

export async function setAssetStatus(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const target = field(formData, "target") as ContentAssetStatus;
  const orderLineIdHint = field(formData, "orderLineId") || null;
  const assetForArticle = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { articleId: true },
  });
  const articleId = assetForArticle?.articleId ?? "";
  const { userId, role } = await requireArticleWriter(articleId, locale);
  const back = afterContentAction({ locale, role, articleId, orderLineIdHint });

  // Only the desk drives the full status machine. Every other role that
  // can reach this action — journalist, buyer, approver, org admin — may
  // only hand a draft over for review from here.
  if (role !== "DESK" && role !== "SUPERADMIN" && !SELF_SERVE_ASSET_TARGETS.has(target)) {
    redirect(back);
  }

  if (ASSET_TARGETS.includes(target)) {
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      include: { article: { select: { organizationId: true } } },
    });
    if (asset) {
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: { status: target },
      });
      // FINAL is never gated on spec compliance (that's per-placement,
      // informational only) — but it does lock every currently-unlocked
      // placement of this article to this exact version.
      if (target === "FINAL") {
        await lockPlacementsOnFinal(asset.articleId, asset.id);
      }
      await recordAudit(userId, "asset.status", `ContentAsset:${asset.id}`, {
        status: target,
      });
      if (target === "IN_REVIEW" || target === "CHANGES_REQUESTED") {
        const hintOrderId = orderLineIdHint
          ? (await prisma.orderLine.findUnique({
              where: { id: orderLineIdHint },
              select: { orderId: true },
            }))?.orderId
          : null;
        await notifyOrg(asset.article.organizationId, {
          kind: "ASSET_REVIEW",
          title:
            target === "IN_REVIEW"
              ? "Content draft ready for review"
              : "Content changes requested",
          link: hintOrderId
            ? `/${locale}/orders/${hintOrderId}`
            : `/${locale}/articles/${articleId}`,
        });
      }
    }
  }
  redirect(back);
}
