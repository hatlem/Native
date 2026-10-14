"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { switchActiveOrg } from "@/lib/active-org";
import { VIEW_AS_COOKIE } from "@/lib/workspace";
import { VIEW_AS_COOKIE_OPTS } from "@/lib/view-as";
import { safeLocale } from "@/i18n/routing";

// The role is read from the database, not the JWT, so a demoted account can't
// start a view from a session issued before the demotion.
async function requireSuperadminId(locale: string): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect(`/${locale}/signin`);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, deactivatedAt: true },
  });
  if (user?.role !== "SUPERADMIN" || user.deactivatedAt) redirect(`/${locale}/signin`);
  return userId;
}

// "Se som kunde" from /desk/users: open the buyer side as one advertiser org.
// No Membership is written, so the customer's team list is untouched.
export async function startViewAs(formData: FormData) {
  const locale = safeLocale(String(formData.get("locale") || ""));
  const organizationId = String(formData.get("organizationId") || "");
  const actorId = await requireSuperadminId(locale);

  const org = await prisma.organization.findFirst({
    where: { id: organizationId, type: "ADVERTISER" },
    select: { id: true, name: true },
  });
  if (!org) redirect(`/${locale}/desk/users?error=view_as_org`);

  const store = await cookies();
  store.set(VIEW_AS_COOKIE, org.id, VIEW_AS_COOKIE_OPTS);
  await switchActiveOrg(org.id);
  await recordAudit(actorId, "superadmin.view_as_start", `Organization:${org.id}`, {
    orgName: org.name,
  });
  redirect(`/${locale}/home`);
}

export async function stopViewAs(formData: FormData) {
  const locale = safeLocale(String(formData.get("locale") || ""));
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const store = await cookies();
  const orgId = store.get(VIEW_AS_COOKIE)?.value ?? null;
  store.delete(VIEW_AS_COOKIE);
  // Back to the superadmin's own default org; the next render picks it.
  await switchActiveOrg(null);
  if (orgId) {
    await recordAudit(session.user.id, "superadmin.view_as_end", `Organization:${orgId}`);
  }
  redirect(`/${locale}/desk/users`);
}
