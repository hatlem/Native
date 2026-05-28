"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  approveCandidate,
  rejectCandidate,
  bulkApproveAboveConfidence,
} from "@/lib/outreach/candidates";
import {
  buildRateCardCampaign,
  selectBatchForSend,
  sendRateCardStep,
} from "@/lib/outreach/campaign";

async function requireSuperadmin(locale: string): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SUPERADMIN") {
    redirect(`/${locale}/desk/titles`);
  }
  return session.user.id;
}

function f(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function approveCandidateAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const candidateId = f(formData, "candidateId");
  if (!candidateId) redirect(`/${locale}/desk/publisher-contacts?err=missing-id`);

  const overrides = {
    email: f(formData, "email") || undefined,
    name: f(formData, "name") || undefined,
    role: f(formData, "role") || undefined,
    phone: f(formData, "phone") || undefined,
  };
  try {
    await approveCandidate({ candidateId, reviewedById: userId, overrides });
    redirect(`/${locale}/desk/publisher-contacts?ok=approved`);
  } catch (err) {
    redirect(
      `/${locale}/desk/publisher-contacts?err=${encodeURIComponent((err as Error).message)}`,
    );
  }
}

export async function rejectCandidateAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const candidateId = f(formData, "candidateId");
  await rejectCandidate({
    candidateId,
    reviewedById: userId,
    reason: f(formData, "reason") || undefined,
  });
  redirect(`/${locale}/desk/publisher-contacts?ok=rejected`);
}

export async function bulkApproveAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const min = parseInt(f(formData, "minConfidence") || "80", 10);
  const result = await bulkApproveAboveConfidence({
    minConfidence: min,
    reviewedById: userId,
  });
  redirect(
    `/${locale}/desk/publisher-contacts?ok=bulk&approved=${result.approved}&failed=${result.failed}`,
  );
}

export async function buildCampaignAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const result = await buildRateCardCampaign({ createdById: userId });
  redirect(
    `/${locale}/desk/publisher-contacts?tab=campaign&ok=built&created=${result.requests_created}&skipped=${result.requests_skipped}`,
  );
}

export async function sendBatchAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const limit = parseInt(f(formData, "limit") || "20", 10);
  const batch = await selectBatchForSend({ limit });
  let sent = 0;
  for (const r of batch) {
    const result = await sendRateCardStep({ requestId: r.id, actorId: userId });
    if ("sent" in result) sent++;
    if ("skipped" in result && result.skipped === "rate_limited") break;
  }
  redirect(`/${locale}/desk/publisher-contacts?tab=campaign&ok=sent&n=${sent}`);
}

export async function sendOneAction(formData: FormData) {
  const locale = f(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const requestId = f(formData, "requestId");
  await sendRateCardStep({ requestId, actorId: userId });
  redirect(`/${locale}/desk/publisher-contacts?tab=campaign&ok=one`);
}
