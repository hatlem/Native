"use server";

import { redirect } from "next/navigation";
import { ContentAssetStatus, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg } from "@/lib/notify";
import { enqueue } from "@/lib/jobs";
import { runSpecCheckForAsset, registerSpecCheckJob } from "@/lib/spec-check-runner";
import { ensureTrackedLinks } from "@/lib/metrics/store";
import { rewriteBodyLinks } from "@/lib/metrics/links";
import { requireLineWriter, requireArticleWriter } from "@/lib/writers/guard";
import { ensureArticleForLine, articleTitleForLine } from "@/lib/writers/article";

registerSpecCheckJob();

const ASSET_TARGETS: ContentAssetStatus[] = [
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "FINAL",
];

// What status transitions a non-desk role is allowed to invoke from
// setAssetStatus. A journalist hands a draft to the desk for review; a
// buyer/approver/org-admin writing their own article does the same. None
// of them approves or finalises from here — the buyer's approve /
// request-changes gate lives in content-review-actions.ts, which
// independently requires the asset to be IN_REVIEW.
const SELF_SERVE_ASSET_TARGETS: ReadonlySet<ContentAssetStatus> = new Set([
  ContentAssetStatus.IN_REVIEW,
]);

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Where an Article sits in the order tree, resolved from the DB rather
// than from a hidden form field: an article may be unlinked (no
// placement chosen yet), in which case there is no order to return to.
async function articleRouting(
  articleId: string,
): Promise<{ orderId: string; orderLineId: string | null }> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { orderLineId: true, orderLine: { select: { orderId: true } } },
  });
  return {
    orderId: article?.orderLine?.orderId ?? "",
    orderLineId: article?.orderLineId ?? null,
  };
}

// Where a content action returns the actor to. Desk/superadmin work out
// of the order page; a journalist works out of the writer line page,
// which is the only surface that shows the ContentBrief. Everyone else —
// buyers, approvers, org admins, plus anyone acting on an article with
// no placement yet — works out of the article detail page.
function afterContentAction(args: {
  locale: string;
  role: string;
  articleId: string;
  orderId: string;
  orderLineId: string | null;
}): string {
  const { locale, role, articleId, orderId, orderLineId } = args;
  if ((role === "DESK" || role === "SUPERADMIN") && orderId) {
    return `/${locale}/desk/orders/${orderId}`;
  }
  if (role === "CONTENT" && orderLineId) {
    return `/${locale}/writer/lines/${orderLineId}`;
  }
  return `/${locale}/articles/${articleId}`;
}

// Appends a new DRAFT version to an article. Shared by the article-keyed
// and the line-keyed entry points below so both produce identical rows.
async function appendDraftVersion(args: {
  articleId: string;
  body: string;
  sourceAssetId: string | null;
  writerProfileId: string | null;
  userId: string;
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
  await enqueue("spec.check", { assetId: asset.id });
}

// Desk confirms which auto-detected outbound links in a produced article
// to track. Each chosen URL becomes a TrackedLink (idempotent) and the
// asset body is rewritten so the published article uses /go/<token>.
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
  const { userId, writerProfileId, role } = await requireArticleWriter(articleId, locale);

  if (body) {
    await appendDraftVersion({ articleId, body, sourceAssetId, writerProfileId, userId });
  }
  const routing = await articleRouting(articleId);
  redirect(afterContentAction({ locale, role, articleId, ...routing }));
}

// The desk composes drafts from the order page, where the unit of work is
// the order line, not the article. A line drafted before any writer is
// staffed has no Article yet, so create one on the way in.
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

  // requireLineWriter only admits desk/superadmin and the line's own
  // journalist, so those are the only two places to return to.
  const back =
    role === "CONTENT"
      ? `/${locale}/writer/lines/${orderLineId}`
      : `/${locale}/desk/orders/${line.orderId}`;

  if (body) {
    const article = await ensureArticleForLine({
      orderLineId,
      organizationId: line.order.organizationId,
      title: await articleTitleForLine(orderLineId),
      createdByUserId: userId,
      createdByRole: role as UserRole,
      assignedWriterId: line.assignedWriterId,
    });
    await appendDraftVersion({
      articleId: article.id,
      body,
      sourceAssetId,
      writerProfileId,
      userId,
    });
  }
  redirect(back);
}

// The client obtains a presigned PUT url via presignArticleUpload
// (src/app/article-library-actions.ts, Task 9), PUTs the file directly to
// R2, then submits this action with the returned key as bodyUrl.
export async function saveUploadedDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const bodyUrl = field(formData, "bodyUrl");
  const { userId, writerProfileId, role } = await requireArticleWriter(articleId, locale);
  const routing = await articleRouting(articleId);
  const back = afterContentAction({ locale, role, articleId, ...routing });

  // The key round-trips through the browser after the presigned PUT, so
  // it is user-controlled. Pin it to the prefix presignArticleUpload
  // issues for THIS article — otherwise a crafted submit could store any
  // object key in the bucket (another org's rate card, say) and have the
  // article page presign a download link for it.
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
    // No spec.check enqueue — uploaded files are never spec-checked (design §Status flow and spec check).
  }
  redirect(back);
}

export async function runSpecCheck(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { articleId: true },
  });
  const articleId = asset?.articleId ?? "";
  const { userId, role } = await requireArticleWriter(articleId, locale);

  await runSpecCheckForAsset(assetId);
  await recordAudit(userId, "asset.spec_check", `ContentAsset:${assetId}`);

  const routing = await articleRouting(articleId);
  redirect(afterContentAction({ locale, role, articleId, ...routing }));
}

export async function setAssetStatus(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const target = field(formData, "target") as ContentAssetStatus;
  const assetForArticle = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { articleId: true },
  });
  const articleId = assetForArticle?.articleId ?? "";
  const { userId, role } = await requireArticleWriter(articleId, locale);
  const routing = await articleRouting(articleId);
  const back = afterContentAction({ locale, role, articleId, ...routing });

  // Only the desk drives the full status machine. Every other role that
  // can reach this action — journalist, buyer, approver, org admin — may
  // only hand a draft over for review from here.
  if (role !== "DESK" && role !== "SUPERADMIN" && !SELF_SERVE_ASSET_TARGETS.has(target)) {
    redirect(back);
  }

  if (ASSET_TARGETS.includes(target)) {
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      include: {
        article: {
          select: {
            organizationId: true,
            orderLineId: true,
            orderLine: { select: { orderId: true } },
          },
        },
      },
    });
    if (asset && !(target === "FINAL" && asset.specPassed !== true)) {
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: { status: target },
      });
      await recordAudit(userId, "asset.status", `ContentAsset:${asset.id}`, {
        status: target,
      });
      if (target === "IN_REVIEW" || target === "CHANGES_REQUESTED") {
        await notifyOrg(asset.article.organizationId, {
          kind: "ASSET_REVIEW",
          title:
            target === "IN_REVIEW"
              ? "Content draft ready for review"
              : "Content changes requested",
          link: asset.article.orderLine
            ? `/${locale}/orders/${asset.article.orderLine.orderId}`
            : `/${locale}/articles/${articleId}`,
        });
      }
    }
  }
  redirect(back);
}
