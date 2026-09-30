"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { approveSharedList } from "@/lib/list-share";
import { marketDefaultLocale } from "@/lib/market-locale";
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
    const org = await prisma.organization.findUnique({
      where: { id: list.organizationId },
      select: { marketCode: true },
    });
    // A template (lib/client-approval-notice.ts): the email goes out in the
    // org's market language and the inbox re-renders it in each reader's,
    // linking to the approved plan itself.
    await notifyOrg(list.organizationId, {
      kind: "PLAN_CLIENT_APPROVED",
      template: { key: "clientApproved", params: { planName: list.name, listId: list.id } },
      locale: org?.marketCode ? marketDefaultLocale(org.marketCode) : "en",
    });
  }
  // Same address, no query: the page itself shows the outcome (approved, or
  // the updated plan with its approve button), and a same-route redirect that
  // only changes searchParams is what breaks soft navigation in prod.
  redirect(`/${locale}/share/${token}`);
}
