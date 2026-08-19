"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { writeActiveListId } from "@/lib/lists";
import {
  createProgramme,
  dissolveProgramme as dissolveProgrammeLists,
  linkWaveArticle,
  unlinkWaveArticle,
  ProgrammeError,
} from "@/lib/programme";
import { createArticle } from "@/app/article-library-actions";

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
  const rationaleKey = str(formData, "rationaleKey") || null;
  // Opt-in checkbox: unchecked boxes are simply absent from the POST.
  const autoSend = formData.get("autoSend") === "1";

  try {
    const result = await createProgramme({
      sourceListId: list.id,
      organizationId: list.organizationId,
      userId: scope.userId ?? null,
      waves,
      spacingWeeks,
      rationaleKey,
      autoSend,
    });
    await recordAudit(scope.userId ?? null, "programme.create", `CampaignProgramme:${result.programmeId}`, {
      sourceListId: list.id,
      waves: result.waveListIds.length,
      spacingWeeks,
      autoSend,
    });
  } catch (e) {
    // Unreachable from the UI (the form only renders for a non-programme
    // list with lines) — a tampered/replayed POST just lands back on /plan.
    if (e instanceof ProgrammeError) {
      console.warn("programme.blocked", { reason: e.code, listId: list.id });
      redirect(`/${locale}/plan`);
    }
    throw e;
  }
  await writeActiveListId(list.id);
  // Plain /plan, never /plan?programme=…: this action is posted FROM /plan,
  // and a same-route redirect that only changes searchParams trips the RSC
  // "router state header" 503 in prod (see CatalogSort.tsx) — the form would
  // sit on "Creating…" forever with the programme already made. The wave
  // strip that replaces the form is the confirmation.
  redirect(`/${locale}/plan`);
}

// "Dissolve programme" from the wave strip — the undo for startProgramme.
// Waves revert to ordinary plans; unsent copies are archived; the programme
// row is archived. The list posted is any wave of the programme (whichever
// the buyer had open) — the lib resolves and dissolves the whole programme.
export async function dissolveProgramme(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const { scope, list } = await ownList(locale, listId);
  const wave = await prisma.savedList.findUnique({
    where: { id: list.id },
    select: { programmeId: true },
  });
  // Not a wave (already dissolved in another tab, or a tampered POST) —
  // nothing to do, land back on /plan which now shows a plain list.
  if (!wave?.programmeId) redirect(`/${locale}/plan`);
  const { kept, archived } = await dissolveProgrammeLists(wave.programmeId);
  await recordAudit(scope.userId ?? null, "programme.dissolve", `CampaignProgramme:${wave.programmeId}`, {
    listId: list.id,
    kept,
    archived,
  });
  // Plain /plan for the same RSC same-route reason as startProgramme above.
  redirect(`/${locale}/plan`);
}

// Link an existing (unlinked-elsewhere-or-not) article to this wave —
// reuses the same organization-scoped article picker flow, not a new one.
export async function linkWaveArticleAction(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const articleId = str(formData, "articleId");
  const { scope, list } = await ownList(locale, listId);
  await linkWaveArticle(list.id, articleId);
  await recordAudit(scope.userId ?? null, "programme.wave_article_link", `SavedList:${list.id}`, { articleId });
  redirect(`/${locale}/plan`);
}

export async function unlinkWaveArticleAction(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const { scope, list } = await ownList(locale, listId);
  await unlinkWaveArticle(list.id);
  await recordAudit(scope.userId ?? null, "programme.wave_article_unlink", `SavedList:${list.id}`);
  redirect(`/${locale}/plan`);
}
