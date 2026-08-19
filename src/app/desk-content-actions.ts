"use server";

import { redirect } from "next/navigation";
import { ContentAssetStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg } from "@/lib/notify";
import { enqueue } from "@/lib/jobs";
import { runSpecCheckForAsset, registerSpecCheckJob } from "@/lib/spec-check-runner";
import { ensureTrackedLinks } from "@/lib/metrics/store";
import { rewriteBodyLinks } from "@/lib/metrics/links";
import { requireLineWriter, requireArticleWriter } from "@/lib/writers/guard";

registerSpecCheckJob();

const ASSET_TARGETS: ContentAssetStatus[] = [
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "FINAL",
];

// What status transitions the CONTENT role is allowed to invoke from
// setAssetStatus. CONTENT hands a draft to the desk for review; it
// never approves or finalises (those gates belong to the buyer + desk).
const CONTENT_ASSET_TARGETS: ReadonlySet<ContentAssetStatus> = new Set([
  ContentAssetStatus.IN_REVIEW,
]);

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
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
  const orderId = field(formData, "orderId");
  const body = field(formData, "body");
  const sourceAssetId = field(formData, "sourceAssetId") || null;
  const { userId, writerProfileId, role } = await requireArticleWriter(articleId, locale);

  if (body) {
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
        body,
        sourceAssetId: sourceAssetId || null,
        authorWriterId: writerProfileId,
      },
    });
    await recordAudit(userId, "asset.draft", `ContentAsset:${asset.id}`, {
      version: nextVersion,
      sourceAssetId: sourceAssetId || null,
    });
    await enqueue("spec.check", { assetId: asset.id });
  }
  redirect(
    role === "CONTENT"
      ? `/${locale}/articles/${articleId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}

// The client obtains a presigned PUT url via presignArticleUpload
// (src/app/article-library-actions.ts, Task 9), PUTs the file directly to
// R2, then submits this action with the returned key as bodyUrl.
export async function saveUploadedDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const orderId = field(formData, "orderId");
  const bodyUrl = field(formData, "bodyUrl");
  const { userId, writerProfileId, role } = await requireArticleWriter(articleId, locale);

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
  redirect(
    role === "CONTENT"
      ? `/${locale}/articles/${articleId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}

export async function runSpecCheck(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { articleId: true },
  });
  const articleId = asset?.articleId ?? "";
  const { userId, role } = await requireArticleWriter(articleId, locale);

  await runSpecCheckForAsset(assetId);
  await recordAudit(userId, "asset.spec_check", `ContentAsset:${assetId}`);

  redirect(
    role === "CONTENT"
      ? `/${locale}/articles/${articleId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}

export async function setAssetStatus(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const target = field(formData, "target") as ContentAssetStatus;
  const assetForArticle = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { articleId: true },
  });
  const articleId = assetForArticle?.articleId ?? "";
  const { userId, role } = await requireArticleWriter(articleId, locale);

  if (role === "CONTENT" && !CONTENT_ASSET_TARGETS.has(target)) {
    redirect(`/${locale}/articles/${articleId}`);
  }

  if (ASSET_TARGETS.includes(target)) {
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      include: { article: { select: { organizationId: true, orderLineId: true } } },
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
          link: asset.article.orderLineId
            ? `/${locale}/orders/${orderId}`
            : `/${locale}/articles/${articleId}`,
        });
      }
    }
  }
  redirect(
    role === "CONTENT"
      ? `/${locale}/articles/${articleId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}
