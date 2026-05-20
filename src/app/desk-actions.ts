"use server";

import { redirect } from "next/navigation";
import { OrderStatus, ContentAssetStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const ORDER_FLOW: OrderStatus[] = [
  "CONFIRMED",
  "IN_PRODUCTION",
  "SCHEDULED",
  "LIVE",
  "COMPLETED",
];

const ASSET_TARGETS: ContentAssetStatus[] = [
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "FINAL",
];

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requireDesk(locale: string) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
}

export async function advanceOrder(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  await requireDesk(locale);

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (order) {
    const idx = ORDER_FLOW.indexOf(order.status);
    if (idx >= 0 && idx < ORDER_FLOW.length - 1) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: ORDER_FLOW[idx + 1] },
      });
    }
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function saveDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderLineId = field(formData, "orderLineId");
  const orderId = field(formData, "orderId");
  const body = field(formData, "body");
  await requireDesk(locale);

  const brief = await prisma.contentBrief.findUnique({
    where: { orderLineId },
    include: { assets: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (brief && body) {
    const nextVersion = (brief.assets[0]?.version ?? 0) + 1;
    await prisma.contentAsset.create({
      data: {
        briefId: brief.id,
        version: nextVersion,
        status: "DRAFT",
        body,
      },
    });
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function runSpecCheck(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  await requireDesk(locale);

  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    include: {
      brief: {
        include: {
          orderLine: true,
        },
      },
    },
  });

  if (asset) {
    const product = await prisma.product.findUnique({
      where: { id: asset.brief.orderLine.productId },
      include: { spec: true },
    });
    const spec = product?.spec;
    const body = asset.body ?? "";
    const words = body.trim() ? body.trim().split(/\s+/).length : 0;
    const issues: string[] = [];

    if (spec?.disclosureLabel) {
      const ok = body
        .toLowerCase()
        .includes(spec.disclosureLabel.toLowerCase());
      if (!ok) issues.push(`Missing disclosure label "${spec.disclosureLabel}"`);
    }
    if (spec?.wordCountMin && words < spec.wordCountMin) {
      issues.push(`Too short: ${words} < ${spec.wordCountMin} words`);
    }
    if (spec?.wordCountMax && words > spec.wordCountMax) {
      issues.push(`Too long: ${words} > ${spec.wordCountMax} words`);
    }

    await prisma.contentAsset.update({
      where: { id: asset.id },
      data: {
        specPassed: issues.length === 0,
        reviewNotes:
          issues.length === 0
            ? `Spec passed (${words} words)`
            : issues.join("; "),
      },
    });
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function setAssetStatus(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const target = field(formData, "target") as ContentAssetStatus;
  await requireDesk(locale);

  if (ASSET_TARGETS.includes(target)) {
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
    });
    // FINAL requires a passing spec check.
    if (asset && !(target === "FINAL" && asset.specPassed !== true)) {
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: { status: target },
      });
    }
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function issueInvoice(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  await requireDesk(locale);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { quote: { include: { lines: true } }, invoices: true },
  });

  if (order && order.invoices.length === 0) {
    const q = order.quote;
    const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.invoice.create({
        data: {
          organizationId: order.organizationId,
          orderId: order.id,
          status: "ISSUED",
          currency: q.currency,
          subtotal: q.subtotal,
          vatPct: q.vatPct,
          total: q.total,
          issuedAt: new Date(),
          dueAt,
          lines: {
            create: q.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitAmount: l.lineTotal,
              lineTotal: l.lineTotal,
            })),
          },
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: { status: "INVOICED" },
      }),
    ]);
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}
