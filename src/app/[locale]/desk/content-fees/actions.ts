"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MarketCode, ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { loadScope } from "@/lib/scope";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Desk/superadmin only. The nav already gates the page, but actions are a
// separate entry point so we re-check here.
async function requireDesk(locale: string): Promise<string | undefined> {
  const scope = await loadScope();
  if (scope.role !== "DESK" && scope.role !== "SUPERADMIN") {
    redirect(`/${locale}/signin`);
  }
  return scope.userId;
}

function parseFee(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function parseMarket(raw: string): MarketCode | null {
  return (Object.values(MarketCode) as string[]).includes(raw)
    ? (raw as MarketCode)
    : null;
}

function parseType(raw: string): ProductType | null {
  return (Object.values(ProductType) as string[]).includes(raw)
    ? (raw as ProductType)
    : null;
}

export async function createContentFeeRule(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireDesk(locale);

  const greenfieldFee = parseFee(field(formData, "greenfieldFee"));
  const currency = field(formData, "currency").toUpperCase();
  if (greenfieldFee === null || currency.length !== 3) {
    redirect(`/${locale}/desk/content-fees?error=invalid`);
  }
  const adaptationRaw = field(formData, "adaptationFee");
  const adaptationFee = adaptationRaw ? parseFee(adaptationRaw) : null;

  const rule = await prisma.contentFeeRule.create({
    data: {
      marketCode: parseMarket(field(formData, "marketCode")),
      productType: parseType(field(formData, "productType")),
      currency,
      greenfieldFee,
      adaptationFee,
      note: field(formData, "note") || null,
    },
  });
  await recordAudit(userId, "contentFeeRule.create", `ContentFeeRule:${rule.id}`, {
    marketCode: rule.marketCode,
    productType: rule.productType,
    greenfieldFee,
    currency,
  });
  revalidatePath(`/${locale}/desk/content-fees`);
  redirect(`/${locale}/desk/content-fees`);
}

// Edit a rule's economics in place (amounts + note). Market/type/currency
// identity is immutable — to change those, deactivate and create a new
// rule, so historical quotes stay traceable to the rule that priced them.
export async function updateContentFeeRule(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireDesk(locale);
  const id = field(formData, "id");

  const greenfieldFee = parseFee(field(formData, "greenfieldFee"));
  if (greenfieldFee === null) {
    redirect(`/${locale}/desk/content-fees?error=invalid`);
  }
  const adaptationRaw = field(formData, "adaptationFee");
  const adaptationFee = adaptationRaw ? parseFee(adaptationRaw) : null;

  const rule = await prisma.contentFeeRule.findUnique({ where: { id } });
  if (rule) {
    await prisma.contentFeeRule.update({
      where: { id },
      data: { greenfieldFee, adaptationFee, note: field(formData, "note") || null },
    });
    await recordAudit(userId, "contentFeeRule.update", `ContentFeeRule:${id}`, {
      greenfieldFee,
      adaptationFee,
    });
  }
  revalidatePath(`/${locale}/desk/content-fees`);
  redirect(`/${locale}/desk/content-fees`);
}

// Flip active on/off so a rule can be retired without losing its history
// (and any audit trail of past quotes that used it).
export async function toggleContentFeeRule(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireDesk(locale);
  const id = field(formData, "id");
  const active = field(formData, "active") === "1";

  const rule = await prisma.contentFeeRule.findUnique({ where: { id } });
  if (rule) {
    await prisma.contentFeeRule.update({ where: { id }, data: { active } });
    await recordAudit(userId, "contentFeeRule.toggle", `ContentFeeRule:${id}`, {
      active,
    });
  }
  revalidatePath(`/${locale}/desk/content-fees`);
  redirect(`/${locale}/desk/content-fees`);
}
