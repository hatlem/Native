"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  parseWriterProfileForm,
  submittedProfileValues,
  type WriterProfileState,
} from "@/lib/writers/profile";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
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

// Validated on the server (the form's own constraints are only a hint) and
// driven by useActionState, so the writer sees exactly which fields to fix,
// or a saved confirmation — never a silent no-op or a silently cleared
// value.
export async function updateWriterProfile(
  _prev: WriterProfileState,
  formData: FormData,
): Promise<WriterProfileState> {
  const locale = field(formData, "locale") || "en";
  const { userId, writerId } = await requireWriter(locale);

  const parsed = parseWriterProfileForm(formData);
  if (!parsed.ok) {
    return { status: "error", fields: parsed.fields, values: submittedProfileValues(formData) };
  }
  const d = parsed.data;

  await prisma.$transaction([
    prisma.writerProfile.update({
      where: { id: writerId },
      data: {
        bio: d.bio,
        portfolioUrl: d.portfolioUrl,
        currency: d.currency,
        ratePerArticle: d.ratePerArticle,
        ratePerWord: d.ratePerWord,
        maxActiveAssignments: d.maxActiveAssignments,
        active: d.active,
      },
    }),
    prisma.writerLanguage.deleteMany({ where: { writerId } }),
    prisma.writerSpecialty.deleteMany({ where: { writerId } }),
    prisma.writerLanguage.createMany({
      data: d.languages.map((l) => ({ writerId, language: l.language, proficiency: l.proficiency })),
    }),
    prisma.writerSpecialty.createMany({
      data: d.specialties.map((topic) => ({ writerId, topic })),
    }),
  ]);
  await recordAudit(userId, "writer.profile_update", `WriterProfile:${writerId}`);

  revalidatePath(`/${locale}/writer/profile`);
  return { status: "saved" };
}
