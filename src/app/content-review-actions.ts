"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { recordAudit } from "@/lib/audit";
import { notifyDesk } from "@/lib/notify";

// Buyer-side counterpart to desk-content-actions.ts's setAssetStatus: a
// buyer may only move a draft from IN_REVIEW to APPROVED or
// CHANGES_REQUESTED — never to DRAFT/FINAL/RETRACTED, which stay
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
      article: {
        select: {
          id: true,
          organizationId: true,
          orderLineId: true,
          orderLine: { select: { orderId: true } },
        },
      },
    },
  });
}

export async function approveContentAsset(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const asset = await loadAssetForBuyer(assetId);
  const scope = await loadScope();
  if (
    !asset ||
    asset.status !== "IN_REVIEW" ||
    !canActOnOrg(scope, asset.article.organizationId)
  ) {
    redirect(`/${locale}/articles/${asset?.article.id ?? ""}`);
  }

  const orderId = asset.article.orderLine?.orderId ?? null;
  await prisma.contentAsset.update({ where: { id: assetId }, data: { status: "APPROVED" } });
  await recordAudit(session.user.id, "asset.status", `ContentAsset:${assetId}`, { status: "APPROVED" });
  await notifyDesk({
    kind: "ASSET_REVIEW",
    title: "Buyer approved a draft",
    link: orderId ? `/${locale}/desk/orders/${orderId}` : `/${locale}/desk/articles/${asset.article.id}`,
  });

  redirect(orderId ? `/${locale}/orders/${orderId}` : `/${locale}/articles/${asset.article.id}`);
}

export async function requestContentChanges(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const note = field(formData, "note");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const asset = await loadAssetForBuyer(assetId);
  const scope = await loadScope();
  if (
    !asset ||
    asset.status !== "IN_REVIEW" ||
    !canActOnOrg(scope, asset.article.organizationId)
  ) {
    redirect(`/${locale}/articles/${asset?.article.id ?? ""}`);
  }

  const orderId = asset.article.orderLine?.orderId ?? null;
  await prisma.contentAsset.update({
    where: { id: assetId },
    data: { status: "CHANGES_REQUESTED", reviewNotes: note || null },
  });
  await recordAudit(session.user.id, "asset.status", `ContentAsset:${assetId}`, {
    status: "CHANGES_REQUESTED",
  });
  await notifyDesk({
    kind: "ASSET_REVIEW",
    title: "Buyer requested changes to a draft",
    link: orderId ? `/${locale}/desk/orders/${orderId}` : `/${locale}/desk/articles/${asset.article.id}`,
  });

  redirect(orderId ? `/${locale}/orders/${orderId}` : `/${locale}/articles/${asset.article.id}`);
}
