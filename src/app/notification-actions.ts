"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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
