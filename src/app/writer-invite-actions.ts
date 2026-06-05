"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { newInviteToken, expiryFromNow } from "@/lib/publisher-invite";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Desk/superadmin issues a single-use, 14-day writer invite.
export async function createWriterInvite(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const email = field(formData, "email").toLowerCase();
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  if (!email) redirect(`/${locale}/desk/writers`);

  const token = newInviteToken();
  const expiresAt = expiryFromNow();
  await prisma.writerInvite.create({
    data: { email, token, expiresAt, createdBy: session.user.id },
  });
  await recordAudit(session.user.id, "writer.invite", `WriterInvite:${email}`, {
    email,
  });

  redirect(`/${locale}/desk/writers`);
}
