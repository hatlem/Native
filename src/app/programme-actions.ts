"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { writeActiveListId } from "@/lib/lists";
import { createProgramme, setWaveAngle, ProgrammeError } from "@/lib/programme";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Guard shared by both actions: the list must exist, be unarchived, and
// belong to an org the caller may act on. Anything else bounces to /plan —
// no leaking of list structure across orgs.
async function ownList(locale: string, listId: string) {
  const scope = await loadScope();
  if (!scope.userId) redirect(`/${locale}/signin`);
  const list = await prisma.savedList.findUnique({
    where: { id: listId },
    select: { id: true, organizationId: true, archivedAt: true },
  });
  if (!list || list.archivedAt || !canActOnOrg(scope, list.organizationId)) {
    redirect(`/${locale}/plan`);
  }
  return { scope, list };
}

// "Run this as a programme" — turn the active list into wave 1 and create
// waves 2..N as full copies with shifted schedules and their own angles.
// Cadence numbers are clamped onto the offered options in the domain layer,
// so a tampered POST can't create a 40-wave programme.
export async function startProgramme(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const { scope, list } = await ownList(locale, listId);

  const waves = Number(str(formData, "waves"));
  const spacingWeeks = Number(str(formData, "spacingWeeks"));
  const angles = formData
    .getAll("angle")
    .map((v) => (typeof v === "string" ? v.trim().slice(0, 300) : ""))
    .map((v) => v || null);
  const rationaleKey = str(formData, "rationaleKey") || null;

  try {
    const result = await createProgramme({
      sourceListId: list.id,
      organizationId: list.organizationId,
      userId: scope.userId ?? null,
      waves,
      spacingWeeks,
      angles,
      rationaleKey,
    });
    await recordAudit(scope.userId ?? null, "programme.create", `CampaignProgramme:${result.programmeId}`, {
      sourceListId: list.id,
      waves: result.waveListIds.length,
      spacingWeeks,
    });
  } catch (e) {
    if (e instanceof ProgrammeError) redirect(`/${locale}/plan?programme=${e.code}`);
    throw e;
  }
  await writeActiveListId(list.id);
  redirect(`/${locale}/plan?programme=created`);
}

// Edit this wave's article angle from the wave strip on /plan.
export async function updateWaveAngle(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const { list } = await ownList(locale, listId);
  await setWaveAngle(list.id, str(formData, "angle") || null);
  redirect(`/${locale}/plan`);
}
