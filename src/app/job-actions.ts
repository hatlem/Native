"use server";

import { redirect } from "next/navigation";
import { requireSuperadmin } from "@/lib/desk-guard";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { discardDeadJob, retryDeadJob } from "@/lib/jobs";
import { safeLocale } from "@/i18n/routing";


// Retry or discard a dead-lettered background job (/desk/jobs). Super admin
// only: a retried job re-sends a webhook or an email, or pushes to the ledger.
async function act(formData: FormData, op: "retry" | "discard"): Promise<never> {
  const locale = safeLocale(String(formData.get("locale") ?? ""));
  const userId = await requireSuperadmin(locale);
  const jobId = String(formData.get("jobId") ?? "");
  const job = jobId ? await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, kind: true } }) : null;
  const done = job ? await (op === "retry" ? retryDeadJob(job.id) : discardDeadJob(job.id)) : false;
  if (job && done) {
    await recordAudit(userId, op === "retry" ? "job.retry" : "job.discard", `Job:${job.id}`, { kind: job.kind });
  }
  redirect(`/${locale}/desk/jobs?ok=${done ? (op === "retry" ? "retried" : "discarded") : "gone"}`);
}

export async function retryJob(formData: FormData): Promise<void> {
  await act(formData, "retry");
}

export async function discardJob(formData: FormData): Promise<void> {
  await act(formData, "discard");
}
