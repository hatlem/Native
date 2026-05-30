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

async function requireDesk(locale: string): Promise<string | undefined> {
  const scope = await loadScope();
  if (scope.role !== "DESK" && scope.role !== "SUPERADMIN") {
    redirect(`/${locale}/signin`);
  }
  return scope.userId;
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

export async function createPlaybook(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireDesk(locale);

  const title = field(formData, "title");
  if (!title) redirect(`/${locale}/desk/playbooks?error=invalid`);

  const pb = await prisma.playbook.create({
    data: {
      title,
      productType: parseType(field(formData, "productType")),
      category: field(formData, "category") || null,
      marketCode: parseMarket(field(formData, "marketCode")),
      angle: field(formData, "angle") || null,
      structure: field(formData, "structure") || null,
      doList: field(formData, "doList") || null,
      dontList: field(formData, "dontList") || null,
      exampleHeadlines: field(formData, "exampleHeadlines") || null,
    },
  });
  await recordAudit(userId, "playbook.create", `Playbook:${pb.id}`, {
    title,
    productType: pb.productType,
    category: pb.category,
    marketCode: pb.marketCode,
  });
  revalidatePath(`/${locale}/desk/playbooks`);
  redirect(`/${locale}/desk/playbooks`);
}

export async function updatePlaybook(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireDesk(locale);
  const id = field(formData, "id");

  const title = field(formData, "title");
  if (!title) redirect(`/${locale}/desk/playbooks?error=invalid`);

  const pb = await prisma.playbook.findUnique({ where: { id } });
  if (pb) {
    await prisma.playbook.update({
      where: { id },
      data: {
        title,
        angle: field(formData, "angle") || null,
        structure: field(formData, "structure") || null,
        doList: field(formData, "doList") || null,
        dontList: field(formData, "dontList") || null,
        exampleHeadlines: field(formData, "exampleHeadlines") || null,
      },
    });
    await recordAudit(userId, "playbook.update", `Playbook:${id}`, { title });
  }
  revalidatePath(`/${locale}/desk/playbooks`);
  redirect(`/${locale}/desk/playbooks`);
}

export async function togglePlaybook(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireDesk(locale);
  const id = field(formData, "id");
  const active = field(formData, "active") === "1";

  const pb = await prisma.playbook.findUnique({ where: { id } });
  if (pb) {
    await prisma.playbook.update({ where: { id }, data: { active } });
    await recordAudit(userId, "playbook.toggle", `Playbook:${id}`, { active });
  }
  revalidatePath(`/${locale}/desk/playbooks`);
  redirect(`/${locale}/desk/playbooks`);
}
