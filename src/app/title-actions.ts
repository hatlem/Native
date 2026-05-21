"use server";

import { redirect } from "next/navigation";
import { ProductType, PriceVisibility } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requireSuperadmin(locale: string): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") {
    redirect(`/${locale}/signin`);
  }
  return session.user.id;
}

// Same shape as prisma/seed.ts — kept inline so activation doesn't have
// to import seed-time data.
const ACTIVATION_BLUEPRINT: {
  type: ProductType;
  perThousandReach: number;
  leadTimeDays: number;
  visibility: PriceVisibility;
  marginPct: number;
  seasonalMultiplier: number;
}[] = [
  {
    type: ProductType.NATIVE_ARTICLE,
    perThousandReach: 25,
    leadTimeDays: 12,
    visibility: PriceVisibility.INDICATIVE,
    marginPct: 22,
    seasonalMultiplier: 1,
  },
  {
    type: ProductType.ADVERTORIAL,
    perThousandReach: 18,
    leadTimeDays: 10,
    visibility: PriceVisibility.INDICATIVE,
    marginPct: 18,
    seasonalMultiplier: 1,
  },
  {
    type: ProductType.NATIVE_DISPLAY,
    perThousandReach: 12,
    leadTimeDays: 7,
    visibility: PriceVisibility.FIRM,
    marginPct: 12,
    seasonalMultiplier: 1.1,
  },
];

// Verified that the title offers native. Creates default products from
// the blueprint (only if none exist yet) and activates the title.
export async function markTitleNative(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const titleId = field(formData, "titleId");
  const userId = await requireSuperadmin(locale);

  const title = await prisma.title.findUnique({
    where: { id: titleId },
    include: {
      market: { select: { currency: true, disclosureLabel: true } },
      _count: { select: { products: true } },
    },
  });
  if (!title) redirect(`/${locale}/desk/titles`);

  if (title._count.products === 0) {
    const reach = title.monthlyReach ?? 100_000;
    for (const bp of ACTIVATION_BLUEPRINT) {
      const basePrice = Math.round((reach / 1000) * bp.perThousandReach);
      await prisma.product.create({
        data: {
          titleId: title.id,
          type: bp.type,
          name: `${title.name} — ${bp.type}`,
          currency: title.market.currency,
          basePrice,
          visibility: bp.visibility,
          leadTimeDays: bp.leadTimeDays,
          active: true,
          bookable: true,
          priceRules: {
            create: {
              label: "standard",
              minVolume: 1,
              marginPct: bp.marginPct,
              seasonalMultiplier: bp.seasonalMultiplier,
            },
          },
          spec: {
            create: {
              wordCountMin:
                bp.type === ProductType.NATIVE_DISPLAY ? null : 500,
              wordCountMax:
                bp.type === ProductType.NATIVE_DISPLAY ? null : 900,
              imagesMin: 2,
              disclosureLabel: title.market.disclosureLabel,
              fileFormats: "JPG, PNG",
              requirements:
                "Clearly marked as paid; editorial-quality copy aligned to the title's house style.",
            },
          },
        },
      });
    }
  } else {
    // Re-activating an existing magazine: flip any inactive products
    // back on so the catalog actually has something to show.
    await prisma.product.updateMany({
      where: { titleId: title.id },
      data: { active: true },
    });
  }

  await prisma.title.update({
    where: { id: title.id },
    data: { active: true, lastVerifiedAt: new Date() },
  });
  await recordAudit(userId, "title.mark_native", `Title:${title.id}`, {
    name: title.name,
    market: title.marketId,
  });
  redirect(`/${locale}/desk/titles`);
}

// Verified that the title does not offer native — record the check but
// keep it out of the catalog.
export async function markTitleNoNative(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const titleId = field(formData, "titleId");
  const userId = await requireSuperadmin(locale);

  const title = await prisma.title.findUnique({ where: { id: titleId } });
  if (!title) redirect(`/${locale}/desk/titles`);

  await prisma.title.update({
    where: { id: title.id },
    data: { active: false, lastVerifiedAt: new Date() },
  });
  await prisma.product.updateMany({
    where: { titleId: title.id },
    data: { active: false },
  });
  await recordAudit(userId, "title.mark_no_native", `Title:${title.id}`, {
    name: title.name,
  });
  redirect(`/${locale}/desk/titles`);
}

// Deactivate an already-live title (super-admin only). Doesn't touch
// the verification timestamp — only the visibility flag.
export async function deactivateTitle(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const titleId = field(formData, "titleId");
  const userId = await requireSuperadmin(locale);

  const title = await prisma.title.findUnique({ where: { id: titleId } });
  if (!title) redirect(`/${locale}/desk/titles`);

  await prisma.title.update({
    where: { id: title.id },
    data: { active: false },
  });
  await prisma.product.updateMany({
    where: { titleId: title.id },
    data: { active: false },
  });
  await recordAudit(userId, "title.deactivate", `Title:${title.id}`, {
    name: title.name,
  });
  redirect(`/${locale}/desk/titles`);
}
