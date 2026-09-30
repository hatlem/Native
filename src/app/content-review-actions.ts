"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadScope, canEditOnOrg } from "@/lib/scope";
import { recordAudit } from "@/lib/audit";
import {
  draftNoticeContext,
  notifyChangesRequested,
  notifyDraftApprovedByBuyer,
} from "@/lib/content/review-notices";
import { supersedeOlderVersions } from "@/lib/content/versions";

// Buyer-side counterpart to desk-content-actions.ts's setAssetStatus: a
// buyer may only move a draft from IN_REVIEW to APPROVED or
// CHANGES_REQUESTED — never to DRAFT/FINAL, which stay
// desk/writer-only. Separate from setAssetStatus (which uses
// requireLineWriter, a DESK/CONTENT-only guard) because the authorization
// shape is different: buyers are checked against the order's organization,
// not the line's assigned writer.

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function loadAssetForBuyer(assetId: string) {
  return prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      status: true,
      version: true,
      article: { select: { id: true, organizationId: true } },
    },
  });
}

export async function approveContentAsset(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId") || null;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const asset = await loadAssetForBuyer(assetId);
  const scope = await loadScope();
  if (
    !asset ||
    asset.status !== "IN_REVIEW" ||
    !canEditOnOrg(scope, asset.article.organizationId)
  ) {
    redirect(`/${locale}/articles/${asset?.article.id ?? ""}`);
  }

  // Approve this version and retire every older open one in the same
  // transaction, so the desk never sees a stale "in review" v1 next to
  // an approved v2.
  await prisma.$transaction(async (tx) => {
    await tx.contentAsset.update({ where: { id: assetId }, data: { status: "APPROVED" } });
    await supersedeOlderVersions(tx, { articleId: asset.article.id, version: asset.version });
  });
  await recordAudit(session.user.id, "asset.status", `ContentAsset:${assetId}`, { status: "APPROVED" });
  // Links to the desk order (from the form, else the article's placement);
  // an unplaced article's detail page is reachable for desk/superadmin too
  // (canWriteArticle).
  const ctx = await draftNoticeContext(assetId, orderId);
  if (ctx) await notifyDraftApprovedByBuyer(ctx);

  redirect(orderId ? `/${locale}/orders/${orderId}` : `/${locale}/articles/${asset.article.id}`);
}

export async function requestContentChanges(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const note = field(formData, "note");
  const orderId = field(formData, "orderId") || null;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const asset = await loadAssetForBuyer(assetId);
  const scope = await loadScope();
  if (
    !asset ||
    asset.status !== "IN_REVIEW" ||
    !canEditOnOrg(scope, asset.article.organizationId)
  ) {
    redirect(`/${locale}/articles/${asset?.article.id ?? ""}`);
  }

  await prisma.contentAsset.update({
    where: { id: assetId },
    data: { status: "CHANGES_REQUESTED", reviewNotes: note || null },
  });
  await recordAudit(session.user.id, "asset.status", `ContentAsset:${assetId}`, {
    status: "CHANGES_REQUESTED",
  });
  // The desk gets the buyer's comment; the assigned writer, who does the
  // rewrite, is told directly (see approveContentAsset for the links).
  const ctx = await draftNoticeContext(assetId, orderId);
  if (ctx) await notifyChangesRequested(ctx, "client", note || null);

  redirect(orderId ? `/${locale}/orders/${orderId}` : `/${locale}/articles/${asset.article.id}`);
}
