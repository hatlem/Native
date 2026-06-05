"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  ContentLanguage,
  ContentTopic,
  LanguageProficiency,
} from "@prisma/client";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function decimalOrNull(raw: string): string | null {
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? String(n) : null;
}

async function requireWriter(
  locale: string,
): Promise<{ userId: string; writerId: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== "CONTENT") {
    redirect(`/${locale}/signin`);
  }
  const profile = await prisma.writerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) redirect(`/${locale}/signin`);
  return { userId: session.user.id, writerId: profile.id };
}

export async function updateWriterProfile(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { userId, writerId } = await requireWriter(locale);

  const languages = formData
    .getAll("languages")
    .filter((v): v is string => typeof v === "string")
    .filter((v) => v in ContentLanguage) as ContentLanguage[];
  const topics = formData
    .getAll("specialties")
    .filter((v): v is string => typeof v === "string")
    .filter((v) => v in ContentTopic) as ContentTopic[];
  const proficiencyRaw = field(formData, "proficiency");
  const proficiency: LanguageProficiency =
    proficiencyRaw in LanguageProficiency
      ? (proficiencyRaw as LanguageProficiency)
      : "FLUENT";

  await prisma.$transaction([
    prisma.writerProfile.update({
      where: { id: writerId },
      data: {
        bio: field(formData, "bio") || null,
        portfolioUrl: field(formData, "portfolioUrl") || null,
        currency: field(formData, "currency") || null,
        ratePerArticle: decimalOrNull(field(formData, "ratePerArticle")),
        ratePerWord: decimalOrNull(field(formData, "ratePerWord")),
        maxActiveAssignments: field(formData, "maxActiveAssignments")
          ? Number(field(formData, "maxActiveAssignments"))
          : null,
        active: field(formData, "active") === "on",
      },
    }),
    prisma.writerLanguage.deleteMany({ where: { writerId } }),
    prisma.writerSpecialty.deleteMany({ where: { writerId } }),
    prisma.writerLanguage.createMany({
      data: languages.map((language) => ({ writerId, language, proficiency })),
    }),
    prisma.writerSpecialty.createMany({
      data: topics.map((topic) => ({ writerId, topic })),
    }),
  ]);
  await recordAudit(userId, "writer.profile_update", `WriterProfile:${writerId}`);

  redirect(`/${locale}/writer/profile`);
}
