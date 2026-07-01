"use server";

import { redirect } from "next/navigation";
import { BusinessType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/workspace";
import { loadScope, canActOnOrg } from "@/lib/scope";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

const BUSINESS_TYPES = Object.values(BusinessType) as string[];

// Save the buyer's KYC / billing block onto their active organization. Soft
// gate: this is optional and never blocks the flow. Scope-guarded so an agency
// can only write its own or its selected client's org.
export async function saveKyc(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/signin`);

  const ws = await getWorkspace(session.user.id);
  const orgId = ws?.activeOrgId;
  const scope = await loadScope();
  if (!orgId || !canActOnOrg(scope, orgId)) redirect(`/${locale}/campaign?step=proposal`);

  const businessTypeRaw = str(formData, "businessType");
  const businessType = BUSINESS_TYPES.includes(businessTypeRaw)
    ? (businessTypeRaw as BusinessType)
    : null;

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      businessType,
      legalName: str(formData, "legalName") || null,
      billingEmail: str(formData, "billingEmail") || null,
      addressLine1: str(formData, "addressLine1") || null,
      addressLine2: str(formData, "addressLine2") || null,
      postalCode: str(formData, "postalCode") || null,
      city: str(formData, "city") || null,
    },
  });

  redirect(`/${locale}/campaign?step=proposal`);
}
