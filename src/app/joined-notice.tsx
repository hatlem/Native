import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";

// One-time welcome after claiming an org invite (?joined=1, set by
// lib/invite-landing.ts). Names the org so a member of several orgs can see
// which team they just joined.
export async function JoinedNotice({
  locale,
  organizationId,
  variant,
}: {
  locale: string;
  organizationId: string | null;
  variant: "lists" | "home";
}) {
  if (!organizationId) return null;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  if (!org) return null;
  const t = await getTranslations({ locale, namespace: "joinedNotice" });
  return (
    <div className="banner-info joined-notice" role="status">
      <span>{t(variant, { org: org.name })}</span>
    </div>
  );
}
