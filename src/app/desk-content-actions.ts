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
import { requireLineWriter } from "@/lib/writers/guard";

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
  const orderLineId = field(formData, "orderLineId");
  const orderId = field(formData, "orderId");
  const body = field(formData, "body");
  // Optional: writer flags this as an adaptation of a previously
  // shipped asset. Persisted on ContentAsset.sourceAssetId so the
  // desk can charge adaptation-rate instead of greenfield and the
  // audit chain shows quote-reuse lineage (Maja R2's deeper gap).
  const sourceAssetId = field(formData, "sourceAssetId") || null;
  const { userId, writerProfileId, role } = await requireLineWriter(
    orderLineId,
    locale,
  );

  const brief = await prisma.contentBrief.findUnique({
    where: { orderLineId },
    include: { assets: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (brief && body) {
    const nextVersion = (brief.assets[0]?.version ?? 0) + 1;
    const asset = await prisma.contentAsset.create({
      data: {
        briefId: brief.id,
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
    // Queue spec check rather than block the form submission.
    await enqueue("spec.check", { assetId: asset.id });
  }
  // CONTENT writers return to their console; desk stays on the order page.
  redirect(
    role === "CONTENT"
      ? `/${locale}/writer/lines/${orderLineId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}

export async function runSpecCheck(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { brief: { select: { orderLineId: true } } },
  });
  const orderLineId = asset?.brief.orderLineId ?? "";
  const { userId, role } = await requireLineWriter(orderLineId, locale);

  await runSpecCheckForAsset(assetId);
  await recordAudit(userId, "asset.spec_check", `ContentAsset:${assetId}`);

  redirect(
    role === "CONTENT"
      ? `/${locale}/writer/lines/${orderLineId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}

export async function setAssetStatus(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const target = field(formData, "target") as ContentAssetStatus;
  const assetForLine = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { brief: { select: { orderLineId: true } } },
  });
  const orderLineId = assetForLine?.brief.orderLineId ?? "";
  const { userId, role } = await requireLineWriter(orderLineId, locale);

  // Writers can only hand a draft off for review. APPROVED / FINAL /
  // CHANGES_REQUESTED stay with the desk + buyer.
  if (role === "CONTENT" && !CONTENT_ASSET_TARGETS.has(target)) {
    redirect(`/${locale}/writer/lines/${orderLineId}`);
  }

  if (ASSET_TARGETS.includes(target)) {
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      include: { brief: { select: { orderLine: { select: { orderId: true, id: true } } } } },
    });
    // FINAL requires a passing spec check.
    if (asset && !(target === "FINAL" && asset.specPassed !== true)) {
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: { status: target },
      });
      await recordAudit(userId, "asset.status", `ContentAsset:${asset.id}`, {
        status: target,
      });
      // The buyer cares about review/approval transitions — notify them.
      const order = await prisma.order.findUnique({
        where: { id: asset.brief.orderLine.orderId },
        select: { organizationId: true },
      });
      if (order && (target === "IN_REVIEW" || target === "CHANGES_REQUESTED")) {
        await notifyOrg(order.organizationId, {
          kind: "ASSET_REVIEW",
          title:
            target === "IN_REVIEW"
              ? "Content draft ready for review"
              : "Content changes requested",
          link: `/${locale}/orders/${asset.brief.orderLine.orderId}`,
        });
      }
    }
  }
  redirect(
    role === "CONTENT"
      ? `/${locale}/writer/lines/${orderLineId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}
