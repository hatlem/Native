import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace, VIEW_AS_COOKIE } from "@/lib/workspace";
import { VIEW_AS_CONFIRM_FIELD } from "@/lib/view-as";

// Rendered inside a commit form (accept quotes, instant order). While a
// superadmin views as the org, the form can't be submitted until they confirm
// that the order is real; the commit action checks the same field
// (lib/view-as viewAsCommitConfirmed). Renders nothing for everyone else.
export async function ViewAsConfirm({ locale, orgName }: { locale: string; orgName?: string }) {
  // Cheap exit for every real customer: no cookie, no workspace lookup.
  if (!(await cookies()).get(VIEW_AS_COOKIE)) return null;
  const session = await auth();
  const orgId = (await getWorkspace(session?.user?.id))?.viewingAsOrgId;
  if (!orgId) return null;
  const name =
    orgName ??
    (await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }))?.name ??
    "";

  const t = await getTranslations({ locale, namespace: "viewAs" });
  return (
    <label className="view-as-confirm">
      <input type="checkbox" name={VIEW_AS_CONFIRM_FIELD} value="1" required />
      <span>{t("confirmCommit", { org: name })}</span>
    </label>
  );
}
