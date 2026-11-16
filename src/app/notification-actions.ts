"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { mutedFromEnabled } from "@/lib/notification-prefs";

export async function markAllRead(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);
  await prisma.notification.updateMany({
    where: { userId: session.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  redirect(`/${locale}/notifications`);
}

// Account → Email notifications. The form posts the categories left CHECKED;
// everything else is stored as muted (User.emailMutedCategories).
export async function saveNotificationPrefs(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);
  const enabled = formData.getAll("category").filter((v): v is string => typeof v === "string");
  await prisma.user.update({
    where: { id: session.user.id },
    data: { emailMutedCategories: mutedFromEnabled(enabled) },
  });
  redirect(`/${locale}/account?prefs=saved#notifications`);
}
