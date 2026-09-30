"use server";

import { redirect } from "next/navigation";
import { approveSharedList } from "@/lib/list-share";
import { notifyOrg } from "@/lib/notify";
import { recordAudit } from "@/lib/audit";
import { safeLocale } from "@/i18n/routing";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// The ONE unauthenticated server action in the app: the share token is the
// credential (256-bit, unique-indexed), exactly like the public share page
// itself. It can only approve the list the token resolves to, and only the
// version of it the page showed (`version`): if the plan changed meanwhile,
// nothing is approved and the page reloads with the current plan. The owning
// org is notified once per approved version.
export async function approveSharedPlan(formData: FormData) {
  const locale = safeLocale(str(formData, "locale"));
  const token = str(formData, "token");
  const result = await approveSharedList(token, str(formData, "version"));
  if (result.outcome === "approved") {
    const { list } = result;
    await recordAudit(null, "list.client_approved", `SavedList:${list.id}`, {});
    // A template (lib/client-approval-notice.ts): each email and inbox row
    // in its reader's own language, linking to the approved plan itself.
    // The approving client's share-page language says nothing about theirs.
    await notifyOrg(list.organizationId, {
      kind: "PLAN_CLIENT_APPROVED",
      template: { key: "clientApproved", params: { planName: list.name, listId: list.id } },
    });
  }
  // Same address, no query: the page itself shows the outcome (approved, or
  // the updated plan with its approve button), and a same-route redirect that
  // only changes searchParams is what breaks soft navigation in prod.
  redirect(`/${locale}/share/${token}`);
}
