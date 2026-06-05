"use server";

import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

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

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await prisma.writerInvite.create({
    data: { email, token, expiresAt, createdBy: session.user.id },
  });
  await recordAudit(session.user.id, "writer.invite", `WriterInvite:${email}`, {
    email,
  });

  redirect(`/${locale}/desk/writers`);
}

// Binds a new CONTENT user + empty WriterProfile when the invite is claimed.
// Call from the claim/signup route handler after the User row is created;
// pass the freshly created userId. Returns false if the token is invalid,
// already claimed, or expired.
export async function claimWriterInvite(
  token: string,
  newUserId: string,
): Promise<boolean> {
  const invite = await prisma.writerInvite.findUnique({ where: { token } });
  if (!invite || invite.claimedAt || invite.expiresAt < new Date()) {
    return false;
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: newUserId },
      data: { role: "CONTENT", emailVerifiedAt: new Date() },
    }),
    prisma.writerProfile.create({ data: { userId: newUserId } }),
    prisma.writerInvite.update({
      where: { token },
      data: { claimedAt: new Date(), claimedByUserId: newUserId },
    }),
  ]);
  await recordAudit(
    newUserId,
    "writer.invite_claim",
    `WriterInvite:${invite.id}`,
  );
  return true;
}
