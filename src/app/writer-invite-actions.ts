"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { newInviteToken, expiryFromNow } from "@/lib/publisher-invite";
import { parseWriterInviteForm, type WriterInviteState } from "@/lib/writers/invite";
import { sendWriterInviteEmail } from "@/lib/writers/notify";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requireDeskSession(locale: string) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  return session.user;
}

// The name a writer sees as "X has invited you" — the desk user's name,
// falling back to the local part of their address, never a role.
async function inviterName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  return user?.name || user?.email?.split("@")[0] || "NativeSpin";
}

// Desk/superadmin issues a single-use, 14-day writer invite and emails it
// in the language the desk picked. Driven by useActionState, so it returns
// the outcome for the form to show instead of redirecting.
export async function createWriterInvite(
  _prev: WriterInviteState,
  formData: FormData,
): Promise<WriterInviteState> {
  const locale = field(formData, "locale") || "en";
  const user = await requireDeskSession(locale);

  const parsed = parseWriterInviteForm(formData);
  if (!parsed.ok) return { status: "error", code: "invalidEmail" };
  const { email, locale: inviteLocale } = parsed;

  // A registered address can't claim a writer invite (the claim creates a
  // new account) — say so now rather than letting the writer hit a dead end.
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { status: "error", code: "existingAccount" };

  // One live invite per address: re-inviting replaces the unclaimed one, so
  // only the newest link works.
  const invite = await prisma.$transaction(async (tx) => {
    await tx.writerInvite.deleteMany({ where: { email, claimedAt: null } });
    return tx.writerInvite.create({
      data: {
        email,
        token: newInviteToken(),
        expiresAt: expiryFromNow(),
        createdBy: user.id,
        locale: inviteLocale,
      },
    });
  });
  await recordAudit(user.id, "writer.invite", `WriterInvite:${email}`, {
    email,
    locale: inviteLocale,
  });

  const sent = await sendWriterInviteEmail({
    inviteId: invite.id,
    inviterName: await inviterName(user.id),
  });
  revalidatePath(`/${locale}/desk/writers`);
  return sent ? { status: "sent", email } : { status: "notSent", email };
}

// Re-sends a pending invite's email (same link, same language).
export async function resendWriterInvite(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const user = await requireDeskSession(locale);
  const inviteId = field(formData, "inviteId");

  const invite = await prisma.writerInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, email: true, claimedAt: true, expiresAt: true },
  });
  if (invite && !invite.claimedAt && invite.expiresAt.getTime() > Date.now()) {
    const sent = await sendWriterInviteEmail({
      inviteId: invite.id,
      inviterName: await inviterName(user.id),
    });
    await recordAudit(user.id, "writer.invite_resend", `WriterInvite:${invite.email}`, { sent });
  }
  revalidatePath(`/${locale}/desk/writers`);
}
