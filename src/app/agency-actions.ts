"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CLIENT_COOKIE, getWorkspace } from "@/lib/workspace";
import { recordAudit } from "@/lib/audit";

const MARKET_CODES = Object.values(MarketCode) as string[];

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function createClient(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  if (!ws?.isAgency || !ws.agencyOrgId) {
    redirect(`/${locale}/signin`);
  }

  const name = field(formData, "name");
  const marketCode = field(formData, "market");
  if (!name || !MARKET_CODES.includes(marketCode)) {
    redirect(`/${locale}/agency?error=1`);
  }

  const created = await prisma.organization.create({
    data: {
      name,
      type: "ADVERTISER",
      marketCode: marketCode as MarketCode,
      parentOrgId: ws.agencyOrgId,
    },
  });
  await recordAudit(session?.user?.id ?? null, "client.create", `Organization:${created.id}`, {
    agencyOrgId: ws.agencyOrgId,
    name,
    market: marketCode,
  });
  revalidatePath(`/${locale}/agency`);
  redirect(`/${locale}/agency`);
}

export async function selectClient(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const clientId = field(formData, "clientId");
  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  if (!ws?.isAgency) {
    redirect(`/${locale}/signin`);
  }

  const store = await cookies();
  if (clientId && ws.scopeOrgIds.includes(clientId)) {
    store.set(CLIENT_COOKIE, clientId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    store.delete(CLIENT_COOKIE);
  }
  redirect(`/${locale}/agency`);
}
