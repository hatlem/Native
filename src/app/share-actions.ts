"use server";

import { redirect } from "next/navigation";
import { approveSharedList } from "@/lib/list-share";
import { notifyOrg } from "@/lib/notify";
import { recordAudit } from "@/lib/audit";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// The ONE unauthenticated server action in the app: the share token is the
// credential (256-bit, unique-indexed), exactly like the public share page
// itself. It can only flip clientApprovedAt on the list the token resolves
// to — idempotently, notifying the owning org once.
export async function approveSharedPlan(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const token = str(formData, "token");
  const approved = await approveSharedList(token);
  if (approved) {
    await recordAudit(null, "list.client_approved", `SavedList:${approved.id}`, {});
    await notifyOrg(approved.organizationId, {
      kind: "PLAN_CLIENT_APPROVED",
      title: `Client approved: ${approved.name}`,
      body: "Your client approved the shared plan — it's ready to send to the desk.",
      link: `/${locale}/plan`,
    });
  }
  redirect(`/${locale}/share/${token}`);
}
